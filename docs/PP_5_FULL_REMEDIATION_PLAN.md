# PP.5 Full Remediation Plan

> Last Updated: 2026-05-07
> Audit: [`docs/PP_5_STAGING_AUDIT.md`](./PP_5_STAGING_AUDIT.md)
> Handoff matrix: [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md)
> Execution runbook: [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md)
> Session wrap-up: [`docs/PP_5_SESSION_WRAPUP_2026_05_07.md`](./PP_5_SESSION_WRAPUP_2026_05_07.md)

## Current State

Repo-owned PP.5 work is ready:

- Staging Kustomize overlay exists at `infra/k8s/overlays/staging/`.
- Staging secret template exists at `infra/k8s/staging-secrets-template.yaml`.
- In-repo ArgoCD Application exists at `infra/argocd/phyne-crm-staging-application.yaml`.
- Deploy workflows write image digests to staging, not production.
- Deploy workflows use the workflow-scoped `GITHUB_TOKEN` for checkout and
  same-repo staging digest commits, while keeping `MADFAM_BOT_PAT` for GHCR
  package push access.
- Manual promote and rollback workflows exist.
- Staging secret coverage guard exists: `node scripts/pp5-staging-audit.mjs`.
- Staging env generator exists: `node scripts/pp5-generate-staging-env.mjs`.
- Staging webhook probe generator exists: `node scripts/pp5-webhook-probe.mjs`.
- Consolidated Wave 0 checker exists: `node scripts/pp5-wave0-check.mjs`.
- CI env pass-through is explicit in `turbo.json` so GitHub Actions runtime
  variables, including `DATABASE_URL`, are available inside Turbo tasks.
- The worker package declares the Sentry runtime dependency used by its entry
  point.

Observed blockers from this workspace on 2026-05-07:

- `staging-crm.madfam.io` does not resolve.
- Kubernetes namespace `phyne-crm-staging` now exists.
- ArgoCD Application `phyne-crm-staging` is not installed.
- Secret `phyne-crm-staging-secrets` is not installed.

## Target End State

PP.5 is remediated when:

- `https://staging-crm.madfam.io/api/health` returns `200`.
- ArgoCD app `phyne-crm-staging` is `Synced` and `Healthy`.
- Web and worker run in namespace `phyne-crm-staging` with staging-only DB, Redis, auth, webhook, API, and email secrets.
- Every active inbound provider has a staging webhook destination and distinct staging HMAC secret.
- Every outbound integration from staging PhyneCRM targets staging provider endpoints or an approved read-only fallback.
- Staging email drips are allowlisted.
- Production rows, emails, billing events, grants, artifacts, and provider state are untouched by staging probes.
- Masked restore or deterministic staging seed path is approved and repeatable.
- Manual promote remains the only production mutator.

## Critical Path

1. Create staging namespace.
2. Generate and install staging-only secret values.
3. Install ArgoCD staging Application.
4. Add DNS/tunnel route for `staging-crm.madfam.io`.
5. Validate app health and rollout.
6. Run low-mutation provider probes.
7. Run mutating provider probes.
8. Validate outbound integrations.
9. Add masked restore or approved deterministic seed baseline.
10. Sign off promotion confidence gates.

Provider registration work can run in parallel after step 4, but signed probes
must wait until steps 1-5 are complete.

## Workstream 0 - Repo Guardrails

Owner: PhyneCRM

Status: Ready.

Actions:

- Keep `deploy-web.yml` and `deploy-worker.yml` writing to `infra/k8s/overlays/staging/kustomization.yaml`.
- Keep `promote-to-prod.yml` and `rollback-prod.yml` as the only production digest mutators.
- Run:

```bash
node scripts/pp5-staging-audit.mjs
node scripts/pp5-webhook-probe.mjs list
node scripts/pp5-wave0-check.mjs
pnpm lint
pnpm typecheck
pnpm test
AUTH_BYPASS=false AUTH_SECRET=test-secret-123456 DATABASE_URL=postgresql://phyne:phyne@localhost:5432/phyne_crm REDIS_URL=redis://localhost:6379 NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm build
```

Exit criteria:

- Both scripts pass.
- Every active inbound webhook lane appears in the probe list.
- Wave 0 checker reports only expected external blockers until platform bootstrap is complete.
- CI, test, typecheck, and production build checks pass locally before push.
- `git diff --check` passes.

Operational note:

- `DATABASE_URL=postgresql://phyne:phyne@localhost:5432/phyne_crm pnpm db:migrate`
  should reach Drizzle with a defined URL. A local failure of
  `role "phyne" does not exist` is a workstation DB provisioning issue, not the
  Turbo env-stripping failure that previously broke E2E.

## Workstream 1 - Platform Bootstrap

Owner: Platform / Enclii

Status: Blocked externally.

Actions, in order:

1. Create namespace:

```bash
kubectl apply -f infra/k8s/overlays/staging/namespace.yaml
```

Status: completed from this workspace on 2026-05-07.

2. Generate staging-only values for all keys in `infra/k8s/staging-secrets-template.yaml`.

Start from:

```bash
node scripts/pp5-generate-staging-env.mjs --output /secure/path/phyne-crm-staging.env
```

Use fresh values for every split-sensitive key:

- `AUTH_SECRET`
- all `*_WEBHOOK_SECRET`
- `PHYNE_CRM_EVENTS_SECRET`
- `PHYNE_ENGAGEMENT_EVENTS_SECRET`
- `PHYNECRM_OUTBOUND_SECRET`
- `FEDERATION_API_TOKEN`
- `KARAFIEL_API_KEY`
- `AUTH_JANUA_CLIENT_ID`
- `AUTH_JANUA_CLIENT_SECRET`
- `RESEND_API_KEY`
- `PHYNE_CRM_PROBE_TOKEN`

3. Install the staging secret from a secure env file:

```bash
kubectl -n phyne-crm-staging create secret generic phyne-crm-staging-secrets \
  --from-env-file=/secure/path/phyne-crm-staging.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

4. Install the ArgoCD app:

```bash
kubectl apply -f infra/argocd/phyne-crm-staging-application.yaml
```

5. Add the Cloudflare/tunnel route:

```text
staging-crm.madfam.io -> phyne-crm-web.phyne-crm-staging.svc.cluster.local:80
```

6. Validate:

```bash
node scripts/pp5-wave0-check.mjs
kubectl -n argocd get application phyne-crm-staging
kubectl -n phyne-crm-staging get deploy,svc,pod
curl -fsS https://staging-crm.madfam.io/api/health
```

Exit criteria:

- Namespace exists.
- Secret exists.
- Argo app is `Synced` and `Healthy`.
- Web and worker pods are ready.
- Health endpoint returns `200`.

Rollback:

- Remove DNS/tunnel route.
- Delete Argo app only if needed: `kubectl -n argocd delete application phyne-crm-staging`.
- Leave the namespace/secret in place unless values were compromised.

## Workstream 2 - Provider Environment Split

Owner: Provider teams with PhyneCRM coordination

Status: Not started externally.

Execute lanes from [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md).

Parallel batches:

- Batch A, low mutation: `cotiza`, `forj`, `janua-telemetry`.
- Batch B, contact/lead mutation: `janua`, `tezca-interest`, `tezca-newsletter`, `ceq`.
- Batch C, financial/grants/project mutation: `dhanam`, `fortuna`, `pravara`, `routecraft`, `coforma`, engagement event/artifact lanes.
- Batch D, outbound: Karafiel grant award, Karafiel compliance reads, Cotiza engagement projection, Dhanam referral reward.

Actions:

1. Provider adds staging destination without removing prod destination.
2. Provider installs fresh staging secret.
3. PhyneCRM secret owner installs matching staging env value.
4. Provider sends synthetic event or PhyneCRM runs `pp5-webhook-probe`.
5. Provider and PhyneCRM attach evidence to the lane ticket.

Example:

```bash
COTIZA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send cotiza
```

Exit criteria per lane:

- Signed staging request returns `200`.
- Wrong-secret request returns `401`.
- Expected staging side effect exists.
- Production isolation check is attached.
- Provider rollback plan is documented.

Global exit criteria:

- All active lanes in the handoff matrix are complete or explicitly deferred with owner and reason.
- No staging lane depends on a production write key.

## Workstream 3 - Outbound Split

Owner: Karafiel, Cotiza, Dhanam, PhyneCRM

Status: Waiting on receiver staging endpoints/secrets.

Actions:

- Set `KARAFIEL_API_URL=https://staging-karafiel.madfam.io`.
- Install staging `KARAFIEL_WEBHOOK_SECRET` and `KARAFIEL_API_KEY`.
- Set `COTIZA_API_URL` to staging Cotiza and install `PHYNECRM_OUTBOUND_SECRET`.
- Set `DHANAM_API_URL` to staging Dhanam and install staging `DHANAM_WEBHOOK_SECRET`.
- Trigger outbound flows from staging only.

Exit criteria:

- Karafiel staging receives `grant.awarded`; production Karafiel does not.
- Worker compliance check reads staging Karafiel.
- Cotiza staging receives engagement projection.
- Dhanam staging receives referral reward request.
- All receiver owners confirm no production writes.

## Workstream 4 - Data Safety

Owner: Platform / DB with PhyneCRM signoff

Status: Not implemented.

Preferred target:

- Nightly masked production-to-staging refresh at 03:00 UTC.
- PII masking before data is made available to staging app pods.
- Deterministic fixture overlay after restore, including Tablaco/demo-safe data.

Minimum acceptable interim path:

- Dedicated staging DB.
- `pnpm db:migrate` applied.
- Deterministic staging seed/fixture path.
- No prod PII copied into staging.

PII safety requirements:

- Mask contact emails, names, phones, notes, visitor identifiers, and free-text metadata that may contain PII.
- Preserve referential integrity and enough shape for federation/profile/engagement flows.
- Include a post-refresh validation query set that fails closed if unmasked emails/domains are present outside approved test domains.

Exit criteria:

- DB refresh or seed job is repeatable.
- PII validation is automated.
- Demo cleanup and queue isolation are verified against staging Redis.

## Workstream 5 - Promotion Confidence

Owner: PhyneCRM + Platform

Status: Partially ready.

Actions:

- Confirm Enclii lifecycle callbacks exist for staging deploy, promotion, and rollback.
- Confirm failed staging smoke, failed promotion, and rollback result alerts are visible.
- Run one full staging soak with web and worker changes.
- Execute manual promotion with no skip flags:

```text
workflow_dispatch: promote-to-prod.yml
skip_soak_check=false
skip_smoke_check=false
```

Exit criteria:

- Staging digest has soaked at least 30 minutes.
- Staging smoke passes.
- Production smoke passes after promotion.
- Rollback workflow has been dry-run or executed against a harmless digest target.

## Workstream 6 - Cleanup And Hardening

Owner: PhyneCRM

Status: Backlog after Wave 0-4 completion.

Actions:

- Remove `JANUA_TELEMETRY_WEBHOOK_SECRET` reliance on fallback to `JANUA_WEBHOOK_SECRET` once telemetry split is complete.
- Decide whether to implement `POST /api/webhooks/karafiel` or remove inbound Karafiel references permanently.
- Replace placeholder staging provider URLs in `infra/k8s/staging-secrets-template.yaml` with real service domains.
- Add masked refresh automation when the platform path is settled.
- Review replica/resource policy when staging and production load grow.

Exit criteria:

- No stale PP.5 caveats remain in docs.
- All deferred RFC 0001 rows either close or have explicit owner/date.

## RACI

| Area | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Repo guardrails | PhyneCRM | PhyneCRM | Platform | Provider teams |
| Namespace / Argo / DNS | Platform / Enclii | Platform | PhyneCRM | Provider teams |
| Secrets generation/install | Secrets owner | Platform | Provider teams | PhyneCRM |
| Provider webhook split | Provider teams | Provider teams | PhyneCRM | Platform |
| Outbound receiver readiness | Karafiel / Cotiza / Dhanam | Provider teams | PhyneCRM | Platform |
| Data refresh / masking | Platform / DB | Platform | PhyneCRM | Provider teams |
| Promotion gate | PhyneCRM + Platform | PhyneCRM | Provider teams | MADFAM ops |

## Master Acceptance Checklist

- [x] `node scripts/pp5-staging-audit.mjs` passes.
- [x] `node scripts/pp5-webhook-probe.mjs list` includes all active lanes.
- [x] `node scripts/pp5-wave0-check.mjs` exists and reports current blockers.
- [x] `phyne-crm-staging` namespace exists.
- [ ] `phyne-crm-staging-secrets` is installed with staging-only values.
- [ ] ArgoCD app `phyne-crm-staging` is `Synced` and `Healthy`.
- [ ] `https://staging-crm.madfam.io/api/health` returns `200`.
- [ ] Batch A provider probes pass.
- [ ] Batch B provider probes pass.
- [ ] Batch C provider probes pass.
- [ ] Batch D outbound probes pass.
- [ ] Production isolation evidence exists for every lane.
- [ ] Staging DB refresh or deterministic seed baseline is approved.
- [ ] PII safety validation exists.
- [ ] Promotion and rollback workflows are verified.
- [ ] PP.5 audit status is updated after external work completes.

# PP.5 Full Remediation Plan

> [!IMPORTANT]
> MADFAM-ENCLII-FIRST-LEGACY-RAW v1: This document contains legacy raw infrastructure command examples.
> Routine production operations must use Enclii web, API, or CLI. Treat raw
> `kubectl`, `helm`, SSH, provider CLI/API, `docker exec`, and direct container
> access as platform bootstrap or documented break-glass only, and record any
> missing Enclii adapter gap.


> Last Updated: 2026-05-13 local / 2026-05-13 UTC
> Audit: [`docs/PP_5_STAGING_AUDIT.md`](./PP_5_STAGING_AUDIT.md)
> Handoff matrix: [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md)
> Execution runbook: [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md)
> Session wrap-up: [`docs/PP_5_SESSION_WRAPUP_2026_05_07.md`](./PP_5_SESSION_WRAPUP_2026_05_07.md)

## Current State

Repo-owned PP.5 work is ready:

- Staging Kustomize overlay exists at `infra/k8s/overlays/staging/`.
- Staging secret template exists at `infra/k8s/staging-secrets-template.yaml`.
- In-repo ArgoCD Application exists at `infra/argocd/phynd-crm-staging-application.yaml`.
- Deploy workflows write image digests to staging, not production.
- Deploy workflows use the workflow-scoped `GITHUB_TOKEN` for checkout and
  same-repo staging digest commits, while keeping `MADFAM_BOT_PAT` for GHCR
  package push access.
- Manual promote and rollback workflows exist.
- Staging secret coverage guard exists: `node scripts/pp5-staging-audit.mjs`.
- Staging env generator exists: `node scripts/pp5-generate-staging-env.mjs`.
- Staging env validator exists: `node scripts/pp5-validate-staging-env.mjs`.
- Stability split-gate exists: `pnpm pp5:stability` (`node scripts/pp5-stability-check.mjs`).
- CI E2E gate exists: `.github/workflows/ci.yml` includes an `e2e` job that calls reusable `.github/workflows/e2e.yml` as a dependent status gate.
- CI workflow integrity gate exists: `node scripts/verify-ci-gates.mjs` validates E2E reusable wiring and ensures branch-protection required checks match `ci.yml` job names.
- PP.5 staging baseline is now refreshed nightly by workflow (`.github/workflows/pp5-staging-refresh.yml`), running `pnpm pp5:staging-reset` plus `pnpm pp5:data-safety`.
- Staging webhook probe generator exists: `node scripts/pp5-webhook-probe.mjs`.
- Consolidated Wave 0 checker exists: `node scripts/pp5-wave0-check.mjs`.
- Client project onboarding is available through `engagements.onboardClientProject`
  and `/engagements -> Onboard Client Project`; see
  [`docs/CLIENT_PROJECT_ONBOARDING.md`](./CLIENT_PROJECT_ONBOARDING.md).
- CRM quote acceptance is available through `quotes.accept` and the `/quotes`
  row action; accepted quotes create or confirm a linked order, mark the
  opportunity won, record conversions, and write a `system:quote_approved`
  engagement milestone.
- Client portal checkout can accept a sent/accepted quote, create or reuse a
  signed Dhanam checkout session, publish an invoice artifact, and write
  `system:checkout_created` for the engagement timeline.
- Client portal checkout is balance-aware for partial payments, supports fresh
  retry sessions after failed/cancelled checkout, and surfaces client-safe
  payment state/error copy.
- Dhanam paid webhooks now reconcile matched payments onto CRM orders, update
  order payment state, write Dhanam payment external references, and emit
  `system:payment_reconciled` or `system:payment_unmatched` timeline events.
- Dhanam failed/refunded/disputed/cancelled webhooks now reconcile lifecycle
  changes onto matched CRM orders, write lifecycle external references, update
  order payment state, and emit operator-recoverable timeline events.
- Paid-in-full Dhanam reconciliation now records first-slice production dispatch
  intent per onboarding delivery track using order external references and
  `system:production_dispatch_requested`; missing routing metadata writes
  `system:production_dispatch_blocked`.
- The worker `production-dispatch` queue now scans retryable dispatch-intent
  records every minute, POSTs live provider handoffs to Pravara/Selva, updates
  dispatch metadata, and emits `system:production_dispatch_sent` or
  `system:production_dispatch_failed`.
- CI env pass-through is explicit in `turbo.json` so GitHub Actions runtime
  variables, including `DATABASE_URL`, are available inside Turbo tasks.
- The worker package declares the Sentry runtime dependency used by its entry
  point.
- The web package declares the `pino` runtime dependency externalized by Next.
- Playwright E2E runs through the `@phynd/web` workspace and its browser
  assertions are aligned with the CI auth-bypass mode.
- `pp5:staging-reset` temporary staging bootstrap path exists as a deterministic,
  non-masking baseline for PP.5 readiness.

Observed blockers from this workspace on 2026-05-07 local / 2026-05-08 UTC:

- `staging-phynd.app` does not resolve.
- Kubernetes namespace `phynd-crm-staging` now exists.
- ArgoCD Application `phynd-crm-staging` is installed and synced after the
  staging overlay was made self-contained. It remains degraded until staging
  runtime secrets and DNS/HTTP health are completed.
- Staging Kustomize overlay is now self-contained under
  `infra/k8s/overlays/staging` so ArgoCD can render it with default load
  restrictions.
- Staging image pull secret `ghcr-credentials` is installed so the namespace
  can pull private GHCR images.
- Secret `phynd-crm-staging-secrets` is not installed.

## Target End State

PP.5 is remediated when:

- `https://staging-phynd.app/api/health` returns `200`.
- ArgoCD app `phynd-crm-staging` is `Synced` and `Healthy`.
- Web and worker run in namespace `phynd-crm-staging` with staging-only DB, Redis, auth, webhook, API, and email secrets.
- Every active inbound provider has a staging webhook destination and distinct staging HMAC secret.
- Every outbound integration from staging PhyndCRM targets staging provider endpoints or an approved read-only fallback.
- Staging email drips are allowlisted.
- Production rows, emails, billing events, grants, artifacts, and provider state are untouched by staging probes.
- Masked restore or deterministic staging seed path is approved and repeatable.
- Manual promote remains the only production mutator.

## Critical Path

1. Create staging namespace.
2. Generate and install staging-only secret values.
3. Install ArgoCD staging Application.
4. Add DNS/tunnel route for `staging-phynd.app`.
5. Validate app health and rollout.
6. Run low-mutation provider probes.
7. Run mutating provider probes.
8. Validate outbound integrations.
9. Add masked restore or approved deterministic seed baseline.
10. Run a CRM onboarding dry run for digital, physical, and phygital projects.
11. Sign off promotion confidence gates.

Provider registration work can run in parallel after step 4, but signed probes
must wait until steps 1-5 are complete.

## Workstream 0 - Repo Guardrails

Owner: PhyndCRM

Status: Ready.

Actions:

- Keep `deploy-web.yml` and `deploy-worker.yml` writing to `infra/k8s/overlays/staging/kustomization.yaml`.
- Keep `promote-to-prod.yml` and `rollback-prod.yml` as the only production digest mutators.
- Run:

```bash
pnpm pp5:readiness
node scripts/pp5-staging-audit.mjs
node scripts/pp5-webhook-probe.mjs list
pnpm pp5:branch-protection-check
pnpm pp5:probe-batch A
pnpm pp5:staging-reset
pnpm pp5:probe-batch all --parallelism 5 --run-id "$(date -u +%Y%m%d%H%M%S)"
pnpm pp5:probe-batch-run --batches all --parallelism 5 --run-id "$(date -u +%Y%m%d%H%M%S)"
node scripts/pp5-validate-staging-env.mjs /secure/path/phynd-crm-staging.env
node scripts/pp5-wave0-check.mjs
pnpm pp5:readiness --include-wave0
pnpm pp5:data-safety --database-url postgresql://... --allowlist-domains staging.madfam.io,madfam.io
pnpm lint
pnpm typecheck
pnpm test
pnpm ci:verify-gates
pnpm --filter @phynd/services test -- client-project-onboarding.service.test.ts
pnpm --filter @phynd/services test -- dhanam-checkout.service.test.ts
pnpm --filter @phynd/services test -- quotes.service.test.ts
pnpm --filter @phynd/services test -- payment-reconciliation.service.test.ts
pnpm --filter @phynd/api test -- engagements.router.test.ts
pnpm --filter @phynd/api test -- quotes.router.test.ts
pnpm --filter @phynd/web test -- src/app/api/webhooks/dhanam/__tests__/route.test.ts
pnpm --filter @phynd/web test -- 'src/app/portal/[engagementId]/checkout/__tests__/route.test.ts'
pnpm --filter @phynd/web test -- 'src/app/portal/[engagementId]/__tests__/payment-state.test.ts'
pnpm --filter @phynd/web exec biome check src/components/engagements/create-client-project-dialog.tsx src/components/engagements/engagements-data-table.tsx
pnpm --filter @phynd/web exec biome check src/components/quotes/quotes-data-table.tsx
pnpm --filter @phynd/web exec biome check src/components/orders/orders-data-table.tsx 'src/app/(dashboard)/orders/[id]/page.tsx'
pnpm --filter @phynd/web exec playwright test --list
AUTH_BYPASS=false AUTH_SECRET=test-secret-123456 DATABASE_URL=postgresql://phynd:phynd@localhost:5432/phynd_crm REDIS_URL=redis://localhost:6379 NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm build
```

Exit criteria:

- Both scripts pass.
- Every active inbound webhook lane appears in the probe list.
- Wave 0 checker reports only expected external blockers until platform bootstrap is complete.
- CI, test, typecheck, and production build checks pass locally before push.
- `git diff --check` passes.

Operational note:

- `DATABASE_URL=postgresql://phynd:phynd@localhost:5432/phynd_crm pnpm db:migrate`
  should reach Drizzle with a defined URL. A local failure of
  `role "phynd" does not exist` is a workstation DB provisioning issue, not the
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
node scripts/pp5-generate-staging-env.mjs --output /secure/path/phynd-crm-staging.env
```

Use fresh values for every split-sensitive key:

- `AUTH_SECRET`
- all `*_WEBHOOK_SECRET`
- `PHYND_CRM_EVENTS_SECRET`
- `PHYND_ENGAGEMENT_EVENTS_SECRET`
- `PHYNDCRM_OUTBOUND_SECRET`
- `FEDERATION_API_TOKEN`
- `KARAFIEL_API_KEY`
- `AUTH_JANUA_CLIENT_ID`
- `AUTH_JANUA_CLIENT_SECRET`
- `RESEND_API_KEY`
- `PHYND_CRM_PROBE_TOKEN`

3. Ensure the GHCR image pull secret exists in staging.

If production already has the pull secret, mirror it without printing secret
data:

```bash
kubectl -n phynd-crm get secret ghcr-credentials -o json \
  | jq 'del(.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"], .metadata.creationTimestamp, .metadata.resourceVersion, .metadata.uid, .metadata.managedFields) | .metadata.namespace="phynd-crm-staging"' \
  | kubectl apply -f -
```

4. Install the staging secret from a secure env file:

```bash
node scripts/pp5-validate-staging-env.mjs /secure/path/phynd-crm-staging.env --print-apply-command

kubectl -n phynd-crm-staging create secret generic phynd-crm-staging-secrets \
  --from-env-file=/secure/path/phynd-crm-staging.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

5. Install the ArgoCD app:

```bash
kubectl apply -f infra/argocd/phynd-crm-staging-application.yaml
```

6. Add the Cloudflare/tunnel route:

```text
staging-phynd.app -> phynd-crm-web.phynd-crm-staging.svc.cluster.local:80
```

7. Validate:

```bash
node scripts/pp5-wave0-check.mjs
kubectl -n argocd get application phynd-crm-staging
kubectl -n phynd-crm-staging get deploy,svc,pod
curl -fsS https://staging-phynd.app/api/health
```

Exit criteria:

- Namespace exists.
- GHCR image pull secret exists.
- Secret exists.
- Argo app is `Synced` and `Healthy`.
- Web and worker pods are ready.
- Health endpoint returns `200`.

Rollback:

- Remove DNS/tunnel route.
- Delete Argo app only if needed: `kubectl -n argocd delete application phynd-crm-staging`.
- Leave the namespace/secret in place unless values were compromised.

## Workstream 2 - Provider Environment Split

Owner: Provider teams with PhyndCRM coordination

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
3. PhyndCRM secret owner installs matching staging env value.
4. Provider sends synthetic event or PhyndCRM runs `pp5-webhook-probe`.
   PhyndCRM can also run entire lane groups in batches:

```bash
pnpm pp5:probe-batch A
pnpm pp5:probe-batch B
pnpm pp5:probe-batch C
pnpm pp5:probe-batch all
pnpm pp5:probe-batch-run --batches A,B,C
```

5. Provider and PhyndCRM attach evidence to the lane ticket.

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

Owner: Karafiel, Cotiza, Dhanam, PhyndCRM

Status: Waiting on receiver staging endpoints/secrets.

Actions:

- Set `KARAFIEL_API_URL=https://staging-karafiel.madfam.io`.
- Install staging `KARAFIEL_WEBHOOK_SECRET` and `KARAFIEL_API_KEY`.
- Set `COTIZA_API_URL` to staging Cotiza and install `PHYNDCRM_OUTBOUND_SECRET`.
- Set `DHANAM_API_URL` to staging Dhanam and install staging `DHANAM_WEBHOOK_SECRET`.
- Trigger outbound flows from staging only.

Exit criteria:

- Karafiel staging receives `grant.awarded`; production Karafiel does not.
- Worker compliance check reads staging Karafiel.
- Cotiza staging receives engagement projection.
- Dhanam staging receives referral reward request.
- All receiver owners confirm no production writes.

## Workstream 4 - Data Safety

Owner: Platform / DB with PhyndCRM signoff

Status: Not implemented.

Preferred target:

- Nightly masked production-to-staging refresh at 03:00 UTC.
- PII masking before data is made available to staging app pods.
- Deterministic fixture overlay after restore, including Tablaco/demo-safe data.

Operational status:

- Interim fallback now runs nightly at 03:00 UTC through
  `.github/workflows/pp5-staging-refresh.yml` (`pnpm pp5:staging-reset`) while RFC
  0001 masked restore planning is finalized.

Minimum acceptable interim path:

- Dedicated staging DB.
- `pnpm db:migrate` applied.
- Deterministic staging seed/fixture path.
- No prod PII copied into staging.

PII safety requirements:

- Mask contact emails, names, phones, notes, visitor identifiers, and free-text metadata that may contain PII.
- Preserve referential integrity and enough shape for federation/profile/engagement flows.
- Include a post-refresh validation query set that fails closed if unmasked emails/domains are present outside approved test domains.

Operational requirement:

- Before promoting from a newly refreshed staging dataset, run:

```bash
pnpm pp5:data-safety --database-url "$DATABASE_URL" --allowlist-domains "$EMAIL_ALLOWLIST_DOMAINS"
```

Exit criteria:

- DB refresh or seed job is repeatable.
- PII validation is automated.
- Demo cleanup and queue isolation are verified against staging Redis.

## Workstream 5 - Promotion Confidence

Owner: PhyndCRM + Platform

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

Owner: PhyndCRM

Status: Backlog after Wave 0-4 completion.

Actions:

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
| Repo guardrails | PhyndCRM | PhyndCRM | Platform | Provider teams |
| Namespace / Argo / DNS | Platform / Enclii | Platform | PhyndCRM | Provider teams |
| Secrets generation/install | Secrets owner | Platform | Provider teams | PhyndCRM |
| Provider webhook split | Provider teams | Provider teams | PhyndCRM | Platform |
| Outbound receiver readiness | Karafiel / Cotiza / Dhanam | Provider teams | PhyndCRM | Platform |
| Data refresh / masking | Platform / DB | Platform | PhyndCRM | Provider teams |
| Promotion gate | PhyndCRM + Platform | PhyndCRM | Provider teams | MADFAM ops |

## Master Acceptance Checklist

- [x] `node scripts/pp5-staging-audit.mjs` passes.
- [x] `node scripts/pp5-webhook-probe.mjs list` includes all active lanes.
- [x] `node scripts/pp5-wave0-check.mjs` exists, includes `pnpm pp5:stability`, and reports current blockers.
- [x] `ci.yml` now includes `e2e` as a dependent guarded job.
- [x] `ci.yml` now includes a `workflow-integrity` guard for E2E wiring drift.
- [ ] `pnpm pp5:stability` passes on current staging env input.
- [ ] `pnpm pp5:branch-protection-check` enforces required status checks on `main`.
- [x] `kubectl kustomize infra/k8s/overlays/staging` renders without
  out-of-tree load restrictions.
- [x] `phynd-crm-staging` namespace exists.
- [x] `ghcr-credentials` image pull secret exists in `phynd-crm-staging`.
- [ ] `phynd-crm-staging-secrets` is installed with staging-only values.
- [x] ArgoCD app `phynd-crm-staging` is installed.
- [x] ArgoCD app `phynd-crm-staging` is `Synced`.
- [ ] ArgoCD app `phynd-crm-staging` is `Healthy`.
- [ ] Web and worker rollouts are ready in `phynd-crm-staging`.
- [ ] `https://staging-phynd.app/api/health` returns `200`.
- [ ] Batch A provider probes pass.
- [ ] Batch B provider probes pass.
- [ ] Batch C provider probes pass.
- [ ] Batch D outbound probes pass.
- [ ] Production isolation evidence exists for every lane.
- [x] Staging DB refresh/seed is executed nightly via workflow (interim deterministic baseline).
- [x] PII safety validation exists (`pnpm pp5:data-safety`).
- [ ] Promotion and rollback workflows are verified.
- [ ] PP.5 audit status is updated after external work completes.

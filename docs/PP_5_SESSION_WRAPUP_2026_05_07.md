# PP.5 Session Wrap-Up - 2026-05-07 Local / 2026-05-08 UTC

> [!IMPORTANT]
> MADFAM-ENCLII-FIRST-LEGACY-RAW v1: This document contains legacy raw infrastructure command examples.
> Routine production operations must use Enclii web, API, or CLI. Treat raw
> `kubectl`, `helm`, SSH, provider CLI/API, `docker exec`, and direct container
> access as platform bootstrap or documented break-glass only, and record any
> missing Enclii adapter gap.


> Scope: PhyndCRM PP.5 staging remediation, client/project onboarding,
> self-checkout, Dhanam reconciliation, paid production handoff, provider
> handoff planning, and Wave 0 bootstrap.
>
> Canonical plan: [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md)
> Handoff runbook: [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md)
> Provider matrix: [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md)

## Executive Summary

This session moved PhyndCRM materially closer to a complete client onboarding
and paid-production path, but it is not yet ready for full live client
onboarding at `phynd.app`, `staging-phynd.app`, or the Selva office
without the remaining operator-owned staging bootstrap.

Repo-owned work is now in place for:

- CRM-side client/project onboarding for digital, physical, and phygital
  project skeletons.
- Quote acceptance and confirmed-order readiness.
- Janua-gated client portal checkout against Dhanam.
- Dhanam payment and lifecycle reconciliation back onto CRM orders.
- Paid-in-full production dispatch intent creation for Pravara/Selva tracks.
- Worker execution of pending production dispatch handoffs.
- Staging secret generation/validation guardrails.
- Signed webhook probe generation for every active inbound staging lane.
- ArgoCD-renderable staging manifests.
- A single Wave 0 checker that distinguishes repo readiness from external
  platform/secrets/DNS blockers.

The latest pushed commit on `main` is:

```text
9ae485e fix: harden staging runtime readiness
```

`main` is aligned with `origin/main`, and the working tree was clean at wrap-up.

## Production Readiness Position

Current practical readiness for a full client path is:

- **CRM internal path:** substantially implemented. Operators can model the
  client/project, quote, order, payment state, and production handoff intent
  inside the app.
- **Client self-checkout path:** implemented in code, but not production-signed
  until staging Wave 0 and Dhanam provider probes pass end to end.
- **Physical/phygital manufacturing handoff:** implemented through dispatch
  intent plus worker HTTP dispatch, but provider endpoint secrets and staging
  receiver proof are required before considering it reliable.
- **Live external onboarding:** blocked until `phynd-crm-staging-secrets`,
  staging DNS/tunnel, provider staging destinations, and staging probes are
  complete.

In short: the codebase now has the correct operational skeleton for digital,
physical, and phygital onboarding through quote, payment, production handoff,
and delivery coordination. The remaining gap is live environment completion and
proof, not another broad app rewrite.

## Commits Landed

Recent relevant commits now on `main`:

| Commit | Purpose |
|---|---|
| `9ae485e` | Hardened staging runtime readiness with app labels, worker health probes, expanded Wave 0 checks, and runbook updates. |
| `6976d98` | Made the staging Kustomize overlay self-contained so ArgoCD can render it with default load restrictions. |
| `f9cf2c6` | Updated worker digest to the paid-production handoff implementation. |
| `4a9a0e7` | Updated web digest to the paid-production handoff implementation. |
| `2c4a45f` | Added live paid production handoff dispatch worker/executor behavior. |
| `757c0db` | Improved checkout and dispatch readiness. |
| `8cfe60f` | Added Dhanam payment lifecycle handling. |

Remote GitHub Actions for `9ae485e`:

- `CI`: success.
- `E2E Tests`: success.

## Major Capabilities Added

### Client/Project Onboarding

Added a transactional service for onboarding a client and project into the CRM
workflow:

- Creates or reuses an active contact by external Janua ID or normalized email.
- Creates opportunity, engagement, quote, optional order, artifacts,
  conversion, and timeline events.
- Supports digital, physical, and phygital delivery-track modeling.
- Exposes protected tRPC mutation `engagements.onboardClientProject`.
- Adds the CRM dashboard dialog on the Engagements page.

Primary files:

- [`packages/services/src/onboarding/client-project-onboarding.service.ts`](../packages/services/src/onboarding/client-project-onboarding.service.ts)
- [`packages/api/src/routers/engagements.ts`](../packages/api/src/routers/engagements.ts)
- [`apps/web/src/components/engagements/create-client-project-dialog.tsx`](../apps/web/src/components/engagements/create-client-project-dialog.tsx)
- [`docs/CLIENT_PROJECT_ONBOARDING.md`](./CLIENT_PROJECT_ONBOARDING.md)

### Quote Acceptance

Added a CRM quote acceptance action:

- Accepts the quote.
- Creates or confirms a linked order.
- Marks the opportunity as won.
- Records conversion state.
- Emits `system:quote_approved`.

Primary files:

- [`packages/services/src/quotes/quotes.service.ts`](../packages/services/src/quotes/quotes.service.ts)
- [`packages/api/src/routers/quotes.ts`](../packages/api/src/routers/quotes.ts)
- [`apps/web/src/components/quotes/quotes-data-table.tsx`](../apps/web/src/components/quotes/quotes-data-table.tsx)

### Client Portal Checkout

Added Janua-session-gated checkout flow:

- Accepts a sent or accepted quote.
- Creates or reuses a signed Dhanam checkout session.
- Publishes invoice artifact metadata.
- Emits `system:checkout_created`.
- Handles partial payment state and retryable failed/cancelled sessions.

Primary files:

- [`packages/services/src/payments/dhanam-checkout.service.ts`](../packages/services/src/payments/dhanam-checkout.service.ts)
- [`apps/web/src/app/portal/[engagementId]/checkout/route.ts`](../apps/web/src/app/portal/[engagementId]/checkout/route.ts)
- [`apps/web/src/app/portal/[engagementId]/page.tsx`](../apps/web/src/app/portal/[engagementId]/page.tsx)

### Payment Reconciliation

Added Dhanam webhook reconciliation:

- Maps paid events onto matched orders.
- Updates payment status, paid amount/date, provider, and external payment ID.
- Handles failed, refunded, disputed, and cancelled lifecycle events.
- Emits matched and unmatched timeline events for operator recovery.

Primary files:

- [`packages/services/src/payments/payment-reconciliation.service.ts`](../packages/services/src/payments/payment-reconciliation.service.ts)
- [`apps/web/src/app/api/webhooks/dhanam/route.ts`](../apps/web/src/app/api/webhooks/dhanam/route.ts)
- [`packages/db/src/schema/orders.ts`](../packages/db/src/schema/orders.ts)
- [`apps/web/src/components/orders/orders-data-table.tsx`](../apps/web/src/components/orders/orders-data-table.tsx)
- [`apps/web/src/app/(dashboard)/orders/[id]/page.tsx`](../apps/web/src/app/(dashboard)/orders/[id]/page.tsx)

### Paid Production Dispatch

Added dispatch intent and execution:

- Paid-in-full orders create production-dispatch external references based on
  onboarding delivery tracks.
- Missing route metadata emits `system:production_dispatch_blocked`.
- Worker scans retryable references every minute.
- Worker POSTs live provider handoffs to Pravara/Selva.
- Dispatch references move through sent/retry metadata and emit timeline
  outcomes.

Primary files:

- [`packages/services/src/production/production-dispatch.service.ts`](../packages/services/src/production/production-dispatch.service.ts)
- [`packages/services/src/production/production-dispatch-http.service.ts`](../packages/services/src/production/production-dispatch-http.service.ts)
- [`apps/worker/src/processors/production-dispatch.ts`](../apps/worker/src/processors/production-dispatch.ts)
- [`apps/worker/src/index.ts`](../apps/worker/src/index.ts)

## Staging And Wave 0 Work

### Repo-Controlled Staging Fixes

The staging overlay now renders in ArgoCD because it is self-contained under:

```text
infra/k8s/overlays/staging
```

Added self-contained staging base resources:

- `base/web-deployment.yaml`
- `base/web-service.yaml`
- `base/worker-deployment.yaml`
- `base/network-policies.yaml`
- `base/resource-quota.yaml`
- `base/pdb.yaml`

Also added:

- `app.kubernetes.io/name` labels to web and worker deployments.
- Worker `WORKER_HEALTH_PORT=3001`.
- Worker `/health` startup, readiness, and liveness probes.
- `WORKER_HEALTH_PORT: "3001"` in the staging secret template.

### Cluster State At Wrap-Up

Observed on 2026-05-07 local time / 2026-05-08 UTC:

- Namespace `phynd-crm-staging` exists.
- ArgoCD Application `phynd-crm-staging` exists.
- ArgoCD is synced to `9ae485eb649dce7113b8832a18413628477906b1`.
- ArgoCD sync status is `Synced`.
- ArgoCD operation phase is `Succeeded`.
- ArgoCD health is `Degraded`.
- Staging `ghcr-credentials` exists.
- Web and worker images now pull successfully.
- Web and worker pods are blocked by missing `phynd-crm-staging-secrets`.
- `staging-phynd.app` does not resolve.
- Cloudflared local config does not define static ingress rules. Routes are
  managed remotely through Enclii/switchyard, so DNS/tunnel completion is a
  platform action rather than a PhyndCRM repo patch.

Current pod blocker:

```text
Error: secret "phynd-crm-staging-secrets" not found
```

This is the desired fail-closed state. No placeholder staging secret was
installed.

### Wave 0 Checker Output

Current `node scripts/pp5-wave0-check.mjs` summary:

```text
PASS secret template coverage
PASS webhook probe coverage
PASS staging overlay render
PASS staging namespace
BLOCKED staging secret
PASS staging image pull secret
PASS staging ArgoCD app
PASS staging ArgoCD sync
BLOCKED staging web rollout
BLOCKED staging worker rollout
BLOCKED staging health DNS/HTTP
Wave 0 blocked: 4 check(s) failed
```

The rollout failures are downstream of the missing app secret. After the secret
is installed, rerun Wave 0 before assuming DNS is the only remaining issue.

## Documentation And Tooling Added Or Updated

| File | Purpose |
|---|---|
| [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md) | Canonical PP.5 remediation plan, workstreams, RACI, and acceptance checklist. |
| [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md) | Provider-by-provider inbound, outbound, and read-split handoff matrix. |
| [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md) | Wave 0-3 execution runbook with concrete commands. |
| [`docs/PP_5_STAGING_AUDIT.md`](./PP_5_STAGING_AUDIT.md) | Staging audit and PP.5 deviation notes. |
| [`docs/CLIENT_PROJECT_ONBOARDING.md`](./CLIENT_PROJECT_ONBOARDING.md) | Operator guide for the onboarding workflow. |
| [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) | CI/deploy notes for workflow token use, Turbo env pass-through, E2E invocation, and local build caveats. |
| [`scripts/pp5-staging-audit.mjs`](../scripts/pp5-staging-audit.mjs) | Staging secret template coverage guard. |
| [`scripts/pp5-generate-staging-env.mjs`](../scripts/pp5-generate-staging-env.mjs) | Secure staging env scaffold generator. |
| [`scripts/pp5-validate-staging-env.mjs`](../scripts/pp5-validate-staging-env.mjs) | Fails unsafe or unresolved staging env files before applying secrets. |
| [`scripts/pp5-webhook-probe.mjs`](../scripts/pp5-webhook-probe.mjs) | Generates or sends signed staging webhook probes. |
| [`scripts/pp5-wave0-check.mjs`](../scripts/pp5-wave0-check.mjs) | Consolidated Wave 0 readiness gate. |

## Validation Performed

Local validation performed during the session:

```bash
pnpm lint
pnpm typecheck
pnpm test
AUTH_BYPASS=false AUTH_SECRET=test-secret-123456 DATABASE_URL=postgresql://phynd:phynd@localhost:5432/phynd_crm REDIS_URL=redis://localhost:6379 NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm build
python3 scripts/check-networkpolicy-ports.py infra/k8s/
kubectl kustomize infra/k8s/overlays/staging
kubectl apply -k infra/k8s/overlays/staging --dry-run=server
node --check scripts/pp5-wave0-check.mjs
node scripts/pp5-staging-audit.mjs
node scripts/pp5-webhook-probe.mjs list
node scripts/pp5-wave0-check.mjs
git diff --check
```

Expected local caveats:

- `pnpm lint` exits successfully but still reports existing warning-class
  complexity/non-null assertion diagnostics in older code paths.
- A plain `pnpm build` can fail on a developer machine if `.env.local` has
  `AUTH_BYPASS=true`; production validation correctly rejects auth bypass.
  The production-safe build command above passes.
- `node scripts/pp5-wave0-check.mjs` intentionally exits non-zero until the
  staging app secret, rollouts, and DNS are complete.

Remote validation on latest commit `9ae485e`:

- GitHub Actions `CI`: success.
- GitHub Actions `E2E Tests`: success.

## Provider Probe Coverage

`node scripts/pp5-webhook-probe.mjs list` covers:

| Lane | Receiver | Secret env | Signature header |
|---|---|---|---|
| `cotiza` | `/api/webhooks/cotiza` | `COTIZA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `forj` | `/api/webhooks/forj` | `FORJ_WEBHOOK_SECRET` | `x-webhook-signature` |
| `pravara` | `/api/webhooks/pravara` | `PRAVARA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `janua-telemetry` | `/api/webhooks/janua-telemetry` | `JANUA_TELEMETRY_WEBHOOK_SECRET` | `x-webhook-signature` |
| `janua` | `/api/webhooks/janua` | `JANUA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `dhanam` | `/api/webhooks/dhanam` | `DHANAM_WEBHOOK_SECRET` | `x-dhanam-signature` |
| `fortuna` | `/api/webhooks/fortuna` | `FORTUNA_WEBHOOK_SECRET` | `x-fortuna-signature` |
| `tezca-interest` | `/api/webhooks/tezca` | `TEZCA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `tezca-newsletter` | `/api/webhooks/tezca` | `TEZCA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `routecraft` | `/api/webhooks/routecraft` | `PHYND_CRM_EVENTS_SECRET` | `x-madfam-signature` |
| `legacy-payment` | `/api/v1/events/payment.succeeded` | `PHYND_CRM_EVENTS_SECRET` | `x-madfam-signature` |
| `ceq` | `/api/webhooks/ceq` | `CEQ_WEBHOOK_SECRET` | `x-webhook-signature` |
| `coforma` | `/api/webhooks/coforma` | `COFORMA_WEBHOOK_SECRET` | `x-madfam-signature` |
| `engagement-event` | `/api/v1/engagements/events` | `PHYND_ENGAGEMENT_EVENTS_SECRET` | `x-webhook-signature` |
| `engagement-artifact` | `/api/v1/engagements/artifacts` | `PHYND_ENGAGEMENT_EVENTS_SECRET` | `x-webhook-signature` |

## Remaining Blockers

### Blocker 1 - Staging App Secret

`phynd-crm-staging-secrets` is not installed.

Generate and validate a secure staging env file:

```bash
node scripts/pp5-generate-staging-env.mjs --output /secure/path/phynd-crm-staging.env
node scripts/pp5-validate-staging-env.mjs /secure/path/phynd-crm-staging.env --print-apply-command
```

Apply only after all `REPLACE_ME_*` values are replaced with real staging-only
values:

```bash
kubectl -n phynd-crm-staging create secret generic phynd-crm-staging-secrets \
  --from-env-file=/secure/path/phynd-crm-staging.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

Critical operator-owned values include:

- `DATABASE_URL`
- `REDIS_URL`
- `AUTH_JANUA_ISSUER`
- `AUTH_JANUA_CLIENT_ID`
- `AUTH_JANUA_CLIENT_SECRET`
- provider API URLs
- provider webhook secrets
- `KARAFIEL_API_KEY`
- `RESEND_API_KEY`
- `EMAIL_ALLOWLIST_DOMAINS`
- `PHYND_CRM_PROBE_TOKEN`

### Blocker 2 - DNS/Tunnel Route

`staging-phynd.app` does not resolve.

Target route:

```text
staging-phynd.app -> phynd-crm-web.phynd-crm-staging.svc.cluster.local:80
```

Cloudflared indicates ingress routes are managed remotely through Enclii /
switchyard. Complete this through the platform domain/junction mechanism, not
by editing PhyndCRM app manifests.

### Blocker 3 - Provider Staging Destinations

Provider teams still need to register staging destinations and distinct staging
secrets before signed probe batches run.

Start with:

```bash
node scripts/pp5-webhook-probe.mjs list
```

Then execute lanes from:

```text
docs/PP_5_PROVIDER_HANDOFF_MATRIX.md
docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md
```

### Blocker 4 - Data Safety

Staging still needs either:

- a masked production-to-staging refresh with PII validation, or
- a deterministic staging seed baseline approved for the onboarding dry run.

Do not run production-derived data probes in staging until this is explicit.

## Immediate Next Actions

1. Secrets owner installs validated `phynd-crm-staging-secrets`.
2. Platform/Enclii adds `staging-phynd.app` route to the staging service.
3. Re-run:

```bash
node scripts/pp5-wave0-check.mjs
kubectl -n phynd-crm-staging get deploy,svc,pod,secret
kubectl -n argocd get application phynd-crm-staging
curl -fsS https://staging-phynd.app/api/health
```

4. Once Wave 0 passes, run the CRM onboarding dry run for:

- digital project
- physical project
- phygital project

5. Run provider probe batches in the order documented in the handoff runbook.
6. Attach evidence for quote acceptance, Dhanam checkout, Dhanam paid webhook,
   production dispatch references, provider dispatch receipt, and production
   isolation.

## Explicit Non-Actions

- Did not install placeholder staging app secrets.
- Did not print or commit secret values.
- Did not create production-side provider events.
- Did not run staging webhook probes because staging DNS and app secrets are
  not complete.
- Did not modify Cloudflare tunnel routes directly; routing is managed by
  Enclii/switchyard.
- Did not implement masked data refresh automation in this session.
- Did not promote any new digest to production.

## Known Risks

- Installing production provider write keys in staging would create real CRM,
  billing, grant, manufacturing, artifact, or email side effects.
- Running the onboarding dry run before a staging DB/seed is approved may mix
  test state with unsafe or incomplete data.
- Janua telemetry routing is now required to keep `JANUA_TELEMETRY_WEBHOOK_SECRET`
  distinct from `JANUA_WEBHOOK_SECRET`; the new pp5 stability check fails the
  rollout if fallback behavior is present.
- Inbound `POST /api/webhooks/karafiel` is now implemented for staged
  `grant.awarded` callbacks; remaining work is staging endpoint registration and
  proof collection from provider callbacks.

## Wrap-Up Status

Session can close in this state:

- Repo-controlled PP.5 remediation is committed and pushed.
- GitHub CI and E2E are green on the latest commit.
- Staging manifests render and sync through ArgoCD.
- Staging can pull private GHCR images.
- Wave 0 precisely identifies the remaining external blockers.
- The next owner can continue from the commands in this document without
  rediscovering the implementation state.

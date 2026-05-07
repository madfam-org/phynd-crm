# PP.5 Session Wrap-Up - 2026-05-07

> Scope: PhyneCRM PP.5 staging remediation, provider handoff planning, and Wave 0 bootstrap.
> Canonical plan: [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md)

## Executive Summary

This session advanced PP.5 from audit/remediation planning into executable
handoff and bootstrap artifacts.

Later in the same session, the repo also closed the immediate CI/deploy
blockers that were preventing a clean push-to-main signal:

- API formatting drift is corrected.
- Worker build dependencies now include the Sentry runtime package imported by
  `apps/worker/src/index.ts`.
- Worker tests now declare their Vitest dependency.
- Deploy workflows now use the workflow-scoped `GITHUB_TOKEN` for checkout and
  staging digest commits, while retaining `MADFAM_BOT_PAT` for GHCR package
  push access.
- Turbo now passes runtime env vars such as `DATABASE_URL`, `REDIS_URL`,
  `AUTH_SECRET`, provider URLs/secrets, and worker settings through strict mode.
- Web/API/service/federation tests were tightened where TypeScript or Biome
  previously relied on unsafe assertions.

Repo-owned PP.5 guardrails are now in place:

- Staging environment shape is documented.
- Provider handoff lanes are documented.
- Signed webhook probes can be generated for every active inbound lane.
- A staging env file can be generated with fresh random staging-only secrets
  plus explicit `REPLACE_ME_*` markers for operator-owned values.
- Wave 0 readiness can be checked with one command.
- Client/project onboarding now has a transactional service, protected tRPC
  mutation, and CRM dialog for creating a contact, opportunity, engagement,
  quote, optional production order, quote artifact, conversion, and timeline
  events in one flow.
- Client/project onboarding now reuses existing active contacts by external
  Janua ID or case-insensitive normalized email and fills missing profile
  fields instead of creating duplicate client records.
- CRM quote acceptance now has a dedicated `quotes.accept` action that accepts
  the quote, creates or confirms the linked order, marks the opportunity won,
  records conversions, and writes a `system:quote_approved` engagement
  milestone.
- Dhanam payment reconciliation now updates matched orders with durable payment
  state, records the Dhanam payment external reference, and writes
  `system:payment_reconciled` or `system:payment_unmatched` engagement events.

Cluster-side progress:

- Namespace `phyne-crm-staging` was created successfully.

Remaining Wave 0 blockers:

- Secret `phyne-crm-staging-secrets` is not installed.
- ArgoCD Application `phyne-crm-staging` is not installed.
- DNS/tunnel route for `staging-crm.madfam.io` is not installed or not resolving.

Do not apply the ArgoCD app until the staging secret and DNS/tunnel route are
ready. Doing so would create a broken rollout with placeholder credentials.

## Files Added

| File | Purpose |
|---|---|
| [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md) | Canonical full PP.5 remediation plan: critical path, workstreams, RACI, acceptance checklist. |
| [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md) | Provider-by-provider handoff matrix for inbound, outbound, and read-split lanes. |
| [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md) | Wave 0-3 execution runbook with concrete commands. |
| [`scripts/pp5-staging-audit.mjs`](../scripts/pp5-staging-audit.mjs) | Validates staging secret template coverage for split-sensitive env keys and observed webhook/event secrets. |
| [`scripts/pp5-generate-staging-env.mjs`](../scripts/pp5-generate-staging-env.mjs) | Generates a staging env file scaffold with random split-sensitive secrets and `REPLACE_ME_*` operator values. |
| [`scripts/pp5-validate-staging-env.mjs`](../scripts/pp5-validate-staging-env.mjs) | Rejects unresolved or unsafe staging env files before they are applied as Kubernetes secrets. |
| [`scripts/pp5-webhook-probe.mjs`](../scripts/pp5-webhook-probe.mjs) | Generates signed `curl` probes or sends signed staging webhook probes for all active inbound lanes. |
| [`scripts/pp5-wave0-check.mjs`](../scripts/pp5-wave0-check.mjs) | Consolidated Wave 0 readiness check for secret coverage, namespace, secret, ArgoCD app, and staging health. |
| [`docs/CLIENT_PROJECT_ONBOARDING.md`](./CLIENT_PROJECT_ONBOARDING.md) | Documents the new client/project onboarding service, tRPC mutation, CRM dialog, created records, and limits. |

## Files Updated

| File | Update |
|---|---|
| [`docs/PP_5_STAGING_AUDIT.md`](./PP_5_STAGING_AUDIT.md) | Updated PP.5 state, linked full remediation plan, matrix, and runbook; corrected Karafiel inbound note. |
| [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md) | Marked namespace as complete and Wave 0 checker/env generator as ready. |
| [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md) | Added current Wave 0 status and linked canonical remediation plan. |
| [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md) | Added env generator and consolidated Wave 0 checker. |
| [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) | Added CI/deploy notes for workflow token usage, Turbo env pass-through, Playwright E2E invocation, and local build validation caveats. |
| [`turbo.json`](../turbo.json) | Added `globalPassThroughEnv` coverage for CI, E2E, deploy, webhook, auth, provider, and worker runtime variables. |
| [`.github/workflows/deploy-web.yml`](../.github/workflows/deploy-web.yml) | Switched deploy checkout/digest commit auth to `github.token`; kept GHCR auth on `MADFAM_BOT_PAT`. |
| [`.github/workflows/deploy-worker.yml`](../.github/workflows/deploy-worker.yml) | Switched deploy checkout/digest commit auth to `github.token`; kept GHCR auth on `MADFAM_BOT_PAT`. |
| [`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) | Invokes Playwright install and E2E execution through the `@phyne/web` workspace so CI finds the package-local binary and avoids production-build auth-bypass conflicts. |
| [`apps/web/e2e`](../apps/web/e2e) | Updated stale browser assertions for CI auth bypass, seeded pipeline data, accessible selectors, and current dashboard UI. |
| [`apps/web/package.json`](../apps/web/package.json) | Declared `pino` for Next standalone/server externalization through `serverExternalPackages`. |
| [`packages/services/src/onboarding/client-project-onboarding.service.ts`](../packages/services/src/onboarding/client-project-onboarding.service.ts) | Added transactional onboarding orchestration for contact, opportunity, engagement, quote, optional order, artifacts, conversion, and timeline events; existing active contacts are reused by Janua ID or case-insensitive normalized email. |
| [`packages/services/src/quotes/quotes.service.ts`](../packages/services/src/quotes/quotes.service.ts) | Added transactional quote acceptance side effects for confirmed-order readiness, opportunity win state, conversions, and engagement timeline milestone. |
| [`packages/services/src/payments/dhanam-checkout.service.ts`](../packages/services/src/payments/dhanam-checkout.service.ts) | Added portal-safe, balance-aware quote checkout orchestration that accepts quotes, creates/reuses or refreshes Dhanam checkout sessions, records invoice artifacts, and writes `system:checkout_created`. |
| [`packages/services/src/payments/payment-reconciliation.service.ts`](../packages/services/src/payments/payment-reconciliation.service.ts) | Added Dhanam payment-to-order reconciliation plus failed/refunded/disputed/cancelled lifecycle handling, order payment state updates, external payment references, production dispatch intent, and engagement timeline events. |
| [`packages/services/src/production/production-dispatch.service.ts`](../packages/services/src/production/production-dispatch.service.ts) | Added first-slice paid-order dispatch intent records for Pravara/Selva delivery tracks using existing external references and timeline events. |
| [`packages/services/src/production/production-dispatch-http.service.ts`](../packages/services/src/production/production-dispatch-http.service.ts) | Added live Pravara/Selva HTTP dispatch execution from pending production-dispatch references, including idempotency headers, auth/signature headers, sent/retry metadata, and timeline events. |
| [`apps/worker/src/processors/production-dispatch.ts`](../apps/worker/src/processors/production-dispatch.ts) | Added the worker processor that scans and sends paid production dispatches from durable intent records. |
| [`packages/db/src/schema/orders.ts`](../packages/db/src/schema/orders.ts) | Added durable order payment fields: status, paid amount/date, provider, and external payment ID. |
| [`packages/api/src/routers/engagements.ts`](../packages/api/src/routers/engagements.ts) | Added `engagements.onboardClientProject` protected mutation. |
| [`packages/api/src/routers/quotes.ts`](../packages/api/src/routers/quotes.ts) | Added `quotes.accept` protected mutation. |
| [`apps/web/src/components/engagements/create-client-project-dialog.tsx`](../apps/web/src/components/engagements/create-client-project-dialog.tsx) | Added the CRM dashboard dialog for client/project onboarding. |
| [`apps/web/src/components/engagements/engagements-data-table.tsx`](../apps/web/src/components/engagements/engagements-data-table.tsx) | Added the onboarding action to the Engagements page toolbar. |
| [`apps/web/src/components/quotes/quotes-data-table.tsx`](../apps/web/src/components/quotes/quotes-data-table.tsx) | Added the quote row action for CRM quote acceptance and order confirmation. |
| [`apps/web/src/app/portal/[engagementId]/checkout/route.ts`](../apps/web/src/app/portal/[engagementId]/checkout/route.ts) | Added the Janua-session-gated client checkout route for quote acceptance and Dhanam redirect. |
| [`apps/web/src/app/portal/[engagementId]/page.tsx`](../apps/web/src/app/portal/[engagementId]/page.tsx) | Added portal quote/payment visibility and the client-facing accept/pay action. |
| [`apps/web/src/app/api/webhooks/dhanam/route.ts`](../apps/web/src/app/api/webhooks/dhanam/route.ts) | Wires paid Dhanam events into order payment reconciliation after webhook audit/conversion writes. |
| [`apps/web/src/components/orders/orders-data-table.tsx`](../apps/web/src/components/orders/orders-data-table.tsx) | Surfaces payment status in the orders list and export. |
| [`apps/web/src/app/(dashboard)/orders/[id]/page.tsx`](../apps/web/src/app/(dashboard)/orders/[id]/page.tsx) | Surfaces payment status, paid amount/date, payment provider, and external payment ID on the order detail page. |

No unrelated working-tree changes were reverted; all current edits are part of
the PP.5 guardrail, CI, deploy, or documentation remediation path.

## Cluster Actions Performed

Command run:

```bash
kubectl apply -f infra/k8s/overlays/staging/namespace.yaml
```

Result:

```text
namespace/phyne-crm-staging created
```

Follow-up check:

```bash
kubectl get ns phyne-crm-staging
```

Observed result:

```text
phyne-crm-staging   Active
```

No secret was installed. No ArgoCD Application was applied. No DNS/tunnel route
was changed.

## Validation Results

Passing:

```bash
pnpm lint
pnpm typecheck
pnpm test
AUTH_BYPASS=false AUTH_SECRET=test-secret-123456 DATABASE_URL=postgresql://phyne:phyne@localhost:5432/phyne_crm REDIS_URL=redis://localhost:6379 NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm build
pnpm --filter @phyne/api test
pnpm --filter @phyne/services typecheck
pnpm --filter @phyne/services test
pnpm --filter @phyne/federation lint
pnpm --filter @phyne/federation typecheck
pnpm --filter @phyne/federation test
pnpm --filter @phyne/web typecheck
pnpm --filter @phyne/web test
pnpm --filter @phyne/web exec biome check src/components/engagements/create-client-project-dialog.tsx src/components/engagements/engagements-data-table.tsx
pnpm --filter @phyne/api test -- engagements.router.test.ts
pnpm --filter @phyne/services test -- client-project-onboarding.service.test.ts
pnpm --filter @phyne/web exec playwright test --list
pnpm --filter @phyne/worker lint
pnpm --filter @phyne/worker typecheck
pnpm --filter @phyne/worker build
node --check scripts/pp5-generate-staging-env.mjs
node --check scripts/pp5-staging-audit.mjs
node --check scripts/pp5-validate-staging-env.mjs
node --check scripts/pp5-wave0-check.mjs
node --check scripts/pp5-webhook-probe.mjs
node scripts/pp5-staging-audit.mjs
node scripts/pp5-webhook-probe.mjs list
git diff --check
```

Expected blocked checks:

```bash
node scripts/pp5-wave0-check.mjs
DATABASE_URL=postgresql://phyne:phyne@localhost:5432/phyne_crm pnpm db:migrate
```

Current output summary for Wave 0:

```text
PASS secret template coverage
PASS webhook probe coverage
PASS staging namespace
BLOCKED staging secret
BLOCKED staging ArgoCD app
BLOCKED staging health DNS/HTTP
Wave 0 blocked: 3 check(s) failed
```

The local migration probe now reaches Drizzle with a defined `DATABASE_URL`;
the local machine then rejects the sample CI role with
`role "phyne" does not exist`. This confirms the previous Turbo env-stripping
failure mode is closed. GitHub Actions provides the matching Postgres and Redis
services used by the full Playwright E2E job.

Notes:

- Local production builds must override any developer `.env.local` value of
  `AUTH_BYPASS=true` with `AUTH_BYPASS=false`; production validation correctly
  refuses to prerender protected dashboard pages when bypass is enabled.
- `pnpm lint` exits successfully but still reports warning-class complexity
  diagnostics in older code paths. These are not current CI blockers.

## Provider Probe Coverage

`node scripts/pp5-webhook-probe.mjs list` currently covers:

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
| `routecraft` | `/api/webhooks/routecraft` | `PHYNE_CRM_EVENTS_SECRET` | `x-madfam-signature` |
| `legacy-payment` | `/api/v1/events/payment.succeeded` | `PHYNE_CRM_EVENTS_SECRET` | `x-madfam-signature` |
| `ceq` | `/api/webhooks/ceq` | `CEQ_WEBHOOK_SECRET` | `x-webhook-signature` |
| `coforma` | `/api/webhooks/coforma` | `COFORMA_WEBHOOK_SECRET` | `x-madfam-signature` |
| `engagement-event` | `/api/v1/engagements/events` | `PHYNE_ENGAGEMENT_EVENTS_SECRET` | `x-webhook-signature` |
| `engagement-artifact` | `/api/v1/engagements/artifacts` | `PHYNE_ENGAGEMENT_EVENTS_SECRET` | `x-webhook-signature` |

## Immediate Next Actions

1. Secrets owner generates a secure staging env file:

```bash
node scripts/pp5-generate-staging-env.mjs --output /secure/path/phyne-crm-staging.env
```

2. Secrets owner replaces every `REPLACE_ME_*` value with real staging-only
   values.

Critical operator-owned values:

- `DATABASE_URL`
- `REDIS_URL`
- `AUTH_JANUA_ISSUER`
- `AUTH_JANUA_CLIENT_ID`
- `AUTH_JANUA_CLIENT_SECRET`
- provider API URLs
- `KARAFIEL_API_KEY`
- `RESEND_API_KEY`
- `EMAIL_ALLOWLIST_DOMAINS`

3. Install the staging secret:

```bash
node scripts/pp5-validate-staging-env.mjs /secure/path/phyne-crm-staging.env --print-apply-command

kubectl -n phyne-crm-staging create secret generic phyne-crm-staging-secrets \
  --from-env-file=/secure/path/phyne-crm-staging.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

4. Platform/Enclii installs the ArgoCD app:

```bash
kubectl apply -f infra/argocd/phyne-crm-staging-application.yaml
```

5. Platform/Enclii adds the DNS/tunnel route:

```text
staging-crm.madfam.io -> phyne-crm-web.phyne-crm-staging.svc.cluster.local:80
```

6. Re-run:

```bash
node scripts/pp5-wave0-check.mjs
```

7. Once Wave 0 passes, start provider probe batches from
[`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md).

8. Run the CRM onboarding dry run from
[`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md#wave-15---crm-onboarding-dry-run)
for digital, physical, and phygital projects.

## Explicit Non-Actions

- Did not install `phyne-crm-staging-secrets` with placeholder values.
- Did not apply `infra/argocd/phyne-crm-staging-application.yaml`.
- Did not create or modify DNS/tunnel resources.
- Did not run provider webhook probes against staging because DNS/Argo/secret
  are not ready.
- Did not implement masked restore automation; it remains Workstream 4.
- Did not run the CRM onboarding dry run against staging because Wave 0 is
  still blocked by missing secret, ArgoCD app, and DNS/HTTP health.

## Known Risks

- Applying Argo before secret installation will produce failed pods.
- Pointing staging provider URLs at production write endpoints can create real
  CRM, billing, grant, email, or artifact side effects.
- `JANUA_TELEMETRY_WEBHOOK_SECRET` currently has fallback behavior to
  `JANUA_WEBHOOK_SECRET`; remove reliance on this fallback after telemetry is
  fully split.
- No `POST /api/webhooks/karafiel` inbound route exists in this repo. Karafiel
  PP.5 scope is outbound PhyneCRM to Karafiel unless a real inbound contract is
  added.

## Wrap-Up Status

Session can close with PP.5 in this state:

- Repo documentation and tooling are ready for Wave 0 continuation.
- Cluster namespace is created.
- Remaining blockers are external/secret/platform tasks and are documented with
  exact commands and acceptance criteria.

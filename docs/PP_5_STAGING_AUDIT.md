# PP.5 — PhyndCRM staging audit vs RFC 0001

> Last Updated: 2026-05-07
> RFC: [internal-devops/rfcs/0001-dev-staging-prod-pipeline.md](https://github.com/madfam-org/internal-devops/blob/main/rfcs/0001-dev-staging-prod-pipeline.md)
> Runbook: [internal-devops/runbooks/staging-bootstrap.md](https://github.com/madfam-org/internal-devops/blob/main/runbooks/staging-bootstrap.md)
> Reference impl: [karafiel PP.1 — `infra/k8s/overlays/staging/`](https://github.com/madfam-org/karafiel/tree/main/infra/k8s/overlays/staging)
> Precedents: [dhanam PP.2](https://github.com/madfam-org/dhanam/blob/main/docs/PP_2_STAGING_AUDIT.md), [janua PP.3](https://github.com/madfam-org/janua/blob/main/docs/PP_3_STAGING_AUDIT.md)
> Scope: PP.5 implementation status report. Structural and promote/rollback convergence workstreams (PP.5b / PP.5c) are now present in-repo; remaining items are operational follow-up.
>
> **Parent remediation:** PP.5 is Workstream WS2 in [`MADFAM_TRUTH_LAYER_REMEDIATION.md`](./MADFAM_TRUTH_LAYER_REMEDIATION.md) and Phase 1 in [`ROADMAP.md`](./ROADMAP.md).

## Mission & Vision Readout

- **Mission:** build a phygital CRM that is the operational control plane for MADFAM services by federation, not duplication—owner of CRM-native workflows, with external systems retaining system-of-record authority.
- **Vision:** ship an open-core platform that provides a synthetic, real-time single pane for identity, billing, fabrication status, and engagement activity, then scale to a commercial SaaS and deeper multi-tenant model in later phases.

## Current Status Snapshot

- **What is in place:** staging overlay, staging secret template, ArgoCD staging app, deploy-to-staging digest writes, manual promotion + rollback workflows, and Enclii policy gates.
- **Current compliance vs RFC 0001:** **81%** (`17/21` rows aligned or intentionally deviated).
- **Primary operational blockers:** environment split hardening across provider webhooks/APIs, staging ingress, and masked production→staging data refresh.

## Current Shortcomings

- Incomplete environment split for upstream producers:
  - Some providers still point only to production callback URLs/secrets.
  - Staging secrets are still not guaranteed split-safe for all federation/webhook auth paths.
- No guaranteed staging ingress route (`staging-phynd.app`) in-cluster and in DNS/tunnel plane.
- No automated, nightly masked prod→staging restore/refresh with deterministic fixture baseline and PII protection checks.
  Interim: use deterministic staging reset (`pnpm pp5:staging-reset`) to provide a safe, reproducible baseline until masking automation is implemented.

## Remediation Execution Pattern (Priority Matrix)

### Parallelizable (can run now, in tandem)

- Provider-environment split (by provider): Dhanam, Janua, Karafiel, Fortuna, Tezca, Cotiza, Pravara, Forj, RouteCraft.
- Staging webhook validation checks:
  - each team verifies their callback + secret + signature path to staging.
- Staging DNS/tunnel routing request + smoke validation can start independently and run before/while provider split is still winding down.

### Blocking (must complete before go-live confidence reset)

- Staging ingress + TLS verification (`staging-phynd.app`), including `/api/health` external monitor.
- Nightly masked restore pipeline (or approved deterministic seed+fixture equivalent) once provider split risk drops.

## TL;DR

PhyndCRM now has a staging overlay and dedicated promotion/rollback control
path:

- `deploy-web.yml` and `deploy-worker.yml` write image digests to
  `infra/k8s/overlays/staging/kustomization.yaml`.
- ArgoCD applies `infra/argocd/phynd-crm-staging-application.yaml` into
  `phynd-crm-staging`.
- `.github/workflows/promote-to-prod.yml` performs manual, timed promotion with
  staging smoke check.
- `.github/workflows/rollback-prod.yml` reverts production digests with
  production smoke check.
- `.enclii.yml` declares manual gating, soak and smoke policy.

Compliance against RFC 0001 is now materially improved versus audit baseline:
**~81%** (17/21 rows aligned/intentional, 4 deferred). Remaining operational
items are primarily environment-separation and DB bootstrap hardening.

The outstanding gaps are now:

1. **End-to-end environment split** across external services, webhooks, and API URLs.
2. **Staging ingress/subdomain route** (`staging-phynd.app`) in Cloudflare.
3. **Nightly masked prod→staging refresh** (including PII safety net). Interim
   deterministic fallback now runs nightly via
   `.github/workflows/pp5-staging-refresh.yml` until masked masking pipeline is approved.

## Current state vs RFC 0001 — row-by-row

| # | Area | RFC 0001 expects | PhyndCRM today | Status | Resolution |
|---|---|---|---|---|---|
| 1 | Env-agnostic base | `infra/k8s/base/` | `infra/k8s/production/` plays both base and overlay (digests baked in) | Aligned (intent) | PP.5b: keep `production/` as canonical base, add `overlays/staging/` referencing `../../production`. |
| 2 | `infra/k8s/` location | `infra/k8s/{base,overlays/{staging,production}}` | `infra/k8s/production/` at repo root | Intentional deviation (RFC-compliant path; only nesting is missing) | PP.5b adds `overlays/` subdir; no relocation. |
| 3 | Staging overlay exists | `overlays/staging/kustomization.yaml` with staging patches | Staging overlay exists under `infra/k8s/overlays/staging/` | Aligned | PP.5b adds `overlays/staging` with staging patches over `../../production`. |
| 4 | Both apps in staging | web + worker covered | web + worker deployments are patched by staging overlay | Aligned | PP.5b patches both deployments and namespaces. |
| 5 | Image pinning (prod) | Digest written by promote workflow only | `deploy-{web,worker}.yml` commit digest to staging overlay; prod digest only via `promote-to-prod.yml` | Aligned | PP.5c separates publish vs promote paths. |
| 6 | Image pinning (staging) | Digest written by `build-and-deploy-staging.yml` | Staging digest updates happen via build + `deploy-*.yml` | Aligned | PP.5b targets `overlays/staging/kustomization.yaml`. |
| 7 | Promote workflow | `promote-to-prod.yml` (`workflow_dispatch`) | Manual promotion workflow exists and enforces soak + smoke | Aligned | PP.5c. |
| 8 | Rollback workflow | `rollback-prod.yml`, RTO <5 min | Manual rollback workflow exists with production smoke | Aligned | PP.5c. |
| 9 | Soak period before promote | ≥30 min, smoke-pass required | 30-minute soak and smoke check now in `promote-to-prod.yml` | Aligned | PP.5c policy. |
| 10 | ArgoCD staging Application | `phynd-crm-staging` App watches `overlays/staging/` | In-repo staging application manifest exists | Aligned | PP.5b. |
| 11 | Staging namespace | `<service>-staging` | `phynd-crm-staging` namespace added | Aligned | PP.5b. |
| 12 | Staging subdomain / ingress | `staging-<service>.<domain>` | Ingress not added here; staging route/tunnel still pending | Deferred | Cloudflare ops still required. |
| 13 | Staging smoke test | Structured health retry against staging base URL | `verify-post-deploy.mjs` with 6×20s retries in `promote-to-prod.yml` | Aligned | PP.5c; validates `status: ok` + `service: phynd-crm`. |
| 14 | Replica counts (staging) | 1 per deploy | `replicas: 1` for web + worker in overlay patches | Aligned | PP.5b. |
| 15 | Replica counts (prod) | 2-N per deploy, HPAs tuned | web + worker both `replicas: 1` (deliberate cost choice for a low-traffic internal-ish CRM) | Aligned enough (intentional deviation) | Keep. Flag for review when customer count grows. |
| 16 | Staging namespace convention | `<service>-staging` | PP.5b target: `phynd-crm-staging` | Aligned (by planning) | Document. |
| 17 | Staging secrets template | Separate `<service>-staging-secrets` covering all env vars | `infra/k8s/staging-secrets-template.yaml` added | Aligned | PP.5b. |
| 18 | External service sandbox | Staging Janua tenant, test OAuth clients, sandbox webhook secrets per provider | Not fully operationalized across all providers yet | Deferred | In-progress with external provider teams. |
| 19 | DB: nightly masked restore | 03:00 UTC prod→staging PII-masked | Partially implemented | In progress | Interim baseline now runs nightly via `.github/workflows/pp5-staging-refresh.yml` using `pnpm pp5:staging-reset`; replace with masked prod→staging restore when available. |
| 20 | Promotion pattern declaration | `.enclii.yml` `promotion:` key | `.enclii.yml` contains manual gate + soak + smoke policy | Aligned | PP.5c. |
| 21 | Decommission bypass path | Phase 4 removal of direct-to-prod commits after 14-day soak | Direct-to-prod promotion path removed; `deploy-*` target staging only | Aligned | PP.5c. |

## Summary

| Classification | Count | Rows |
|---|---|---|
| Aligned | 17 | 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 20, 21 |
| Intentional deviation | 1 | 2 |
| Deferred | 3 | 12, 18, 19 |

**Compliance: ~81%** — 17 of 21 rows are now implemented/aligned. Remaining work is operational hardening (rows 12, 18, 19).

## PhyndCRM-specific staging constraints (flag for ops)

PhyndCRM is the seam across the MADFAM webhook graph. Its staging rollout
requires coordinated webhook wiring across every provider.

### 1. Inbound webhook pipeline must be environment-split

Every provider's webhook URL today points at `https://phynd.app`. If
re-pointed wholesale to staging, test events would create real customer
rows in prod PhyndCRM. Each provider must register a **second**
destination for its staging instance with a **distinct** HMAC secret:

| Provider → PhyndCRM inbound | Today | Post-PP.5b |
|---|---|---|
| Karafiel → PhyndCRM inbound | `POST /api/webhooks/karafiel` is implemented (`grant.awarded` and idempotent handling) | Split staging destination for `grant.awarded` and install distinct `KARAFIEL_WEBHOOK_SECRET` |
| Fortuna `grant.discovered` → `/api/webhooks/fortuna` | prod → prod | prod → prod AND staging → staging |
| Tezca `interest.created`, `newsletter.subscribed` → `/api/webhooks/tezca` | prod → prod | prod → prod AND staging → staging |
| Janua `user.created` → `/api/webhooks/janua` | prod → prod | prod → prod AND staging → staging (unblocks on Janua PP.3b) |
| Dhanam billing → `/api/webhooks/dhanam` | prod → prod | prod → prod AND staging → staging (unblocks on Dhanam PP.2b) |
| Cotiza / Pravara / Forj federation → `/api/webhooks/{cotiza,pravara,forj}` | prod → prod | prod → prod AND staging → staging (when those services get staging) |
| RouteCraft payment attribution → `/api/webhooks/routecraft` | prod → prod | prod → prod AND staging → staging |

Inbound HMAC secrets (`FORTUNA_WEBHOOK_SECRET`, `TEZCA_WEBHOOK_SECRET`,
`JANUA_WEBHOOK_SECRET`, `DHANAM_WEBHOOK_SECRET`, `COTIZA_WEBHOOK_SECRET`,
`PRAVARA_WEBHOOK_SECRET`, `FORJ_WEBHOOK_SECRET`, `PHYND_CRM_EVENTS_SECRET`
for RouteCraft) MUST be distinct per env — never reuse prod values in
staging, never cross-wire. `KARAFIEL_WEBHOOK_SECRET` is currently outbound
from PhyndCRM to Karafiel, with the inbound `/api/webhooks/karafiel` receiver now implemented in PhyndCRM.

### 2. Outbound webhook (PhyndCRM → Karafiel) needs the same split

PhyndCRM dispatches `grant.awarded` to Karafiel when a grant application
reaches "Awarded". Staging `phynd-crm-secrets-staging` must set
`KARAFIEL_API_URL` to `https://staging-karafiel.madfam.io` (Karafiel PP.1)
with distinct staging `KARAFIEL_WEBHOOK_SECRET` + `KARAFIEL_API_KEY`. If
staging keeps the prod URL, test grants create phantom rows in prod
Karafiel (Karafiel staging already has `FEATURE_CFDI_AUTO_ISSUE=false`,
so no CFDI damage — but it's still an audit violation).

### 3. Federation provider API URLs must be split

Read-mode federation (via `federationReadOnly: true`) calls 6 provider
APIs: `JANUA_API_URL`, `JANUA_TELEMETRY_API_URL`, `DHANAM_API_URL`,
`COTIZA_API_URL`, `PRAVARA_BASE_URL`, `FORJ_API_URL`, `TEZCA_API_URL`,
`KARAFIEL_API_URL`. Staging values should point at staging provider
instances where available; interim, point at prod with a **distinct
read-only API key** (documented deviation) or return `unavailable` (the
federation layer tolerates partial failures via `Promise.allSettled()`
with the existing `mock-federation-registry.ts` fallback).

### 4. Drip emails must not reach real prospects from staging

The `email-drip` worker processor sends a 4-step Resend sequence to every
lead created from a Tezca event. Staging Resend key must be
domain-scoped (`@madfam.io` / `@staging.madfam.io`). Tezca-side must
emit staging events only for test emails. `EMAIL_ALLOWLIST_DOMAINS`
is implemented in `apps/worker/src/processors/email-drip.ts` and blocks
non-allowlisted recipients whenever the variable is set.

### 5. Demo mode on staging

`/demo` seeds ~63 rows per session with a 1h `demo-cleanup` BullMQ job.
Staging DB sizing should account for demo churn. Staging Redis must be
distinct from prod Redis (queue isolation).

### Secret generation matrix (PP.5b operator checklist)

| Key | Generation |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `{JANUA,DHANAM,COTIZA,PRAVARA,FORJ,TEZCA,KARAFIEL,FORTUNA}_WEBHOOK_SECRET` | `openssl rand -base64 32` each |
| `PHYND_CRM_EVENTS_SECRET` | `openssl rand -base64 32` |
| `FEDERATION_API_TOKEN` | `openssl rand -base64 48` |
| `AUTH_JANUA_CLIENT_ID` / `SECRET` | Register staging OAuth client with staging Janua; redirect URI `https://staging-phynd.app/api/auth/callback/janua` |
| `DATABASE_URL` | Points at `phynd_crm_staging` DB, distinct role |
| `REDIS_URL` | Distinct staging Redis instance |
| `RESEND_API_KEY` | Domain-scoped staging key |
| `NEXT_PUBLIC_APP_URL` | `https://staging-phynd.app` |

Add a `phynd-crm-staging` entry to `janua/infra/secrets/SECRETS_REGISTRY.yaml`
when PP.5b opens.

## Promotion pattern

PhyndCRM is **Pattern B — manual gate** per RFC 0001 § Promotion
mechanics. Reasoning: PhyndCRM owns the ACCA Treasury Hunter HITL
approval queue + the customer lead pipeline + the `conversions` table
(partial unique constraints). A wrong promote can corrupt active grant
applications or silently break the drip worker. `.enclii.yml` now
declares:

```yaml
promotion:
  pattern: manual
  min_soak_minutes: 30
  require_smoke_pass: true
```

## What PP.5 ships

1. **PP.5b — Structural**
   - staging overlay under `infra/k8s/overlays/staging/`
   - `infra/k8s/staging-secrets-template.yaml`
   - `infra/argocd/phynd-crm-staging-application.yaml`
   - `deploy-web` / `deploy-worker` pipelines now write staging digest
   - `CLAUDE.md` pipeline status update
2. **PP.5c — Promote + rollback**
   - `.github/workflows/promote-to-prod.yml`
   - `.github/workflows/rollback-prod.yml`
   - `.enclii.yml`

## What currently ships on push to `main`

| Workflow | Trigger | Effect |
|---|---|---|
| `ci.yml` | PR + push to main | lint + typecheck + test → build |
| `e2e.yml` | PR + push to main | Playwright E2E with Postgres/Redis services |
| `deploy-web.yml` | push to main (apps/web/**, packages/**, pnpm-lock.yaml) | Builds `ghcr.io/madfam-org/phynd-crm/web`, cosign-signs, commits digest to `infra/k8s/overlays/staging/kustomization.yaml`, Enclii lifecycle callback |
| `deploy-worker.yml` | push to main (apps/worker/**, packages/**, pnpm-lock.yaml) | Same shape for worker |
| `promote-to-prod.yml` | manual | Promotes staging digests to production with soak + smoke |
| `rollback-prod.yml` | manual | Rolls back production web/worker digests with smoke |

## Cross-references

- RFC 0001 — `internal-devops/rfcs/0001-dev-staging-prod-pipeline.md`
- Runbook — `internal-devops/runbooks/staging-bootstrap.md`
- Reference impl — `karafiel/infra/k8s/overlays/staging/kustomization.yaml` (PP.1)
- PP.2 precedent — `dhanam/docs/PP_2_STAGING_AUDIT.md`
- PP.3 precedent — `janua/docs/PP_3_STAGING_AUDIT.md`
- Secrets registry — `janua/infra/secrets/SECRETS_REGISTRY.yaml` (PP.5b will add `phynd-crm-staging` entry)
- Tunnel routing — `enclii/infra/k8s/production/cloudflared-unified.yaml` (PP.5b ops action: add `staging-phynd.app` route)
- Full remediation plan — [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md)
- Provider handoff tracker — [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md)
- Handoff execution runbook — [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md)
- Session wrap-up — [`docs/PP_5_SESSION_WRAPUP_2026_05_07.md`](./PP_5_SESSION_WRAPUP_2026_05_07.md)
- This PR — `feat/pp-5-phynd-crm-staging-audit`

## PP.5 Remediation Plan (Full, Priority-Ordered)

Canonical execution plan: [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md).

### Priority 0 — Safe rollout gate (now)

- Keep `deploy-web.yml` and `deploy-worker.yml` scoped to staging digest writes only (already in place).
- Keep `promote-to-prod.yml` / `rollback-prod.yml` as the only production mutators.
- Add/verify alerts for missing staging smoke, failed promotion, and rollback outcomes (if not already covered by Enclii webhooks).
- Run `node scripts/pp5-staging-audit.mjs` before any split rollout to confirm staging secrets contain all
  required split-sensitive env keys and observed webhook/event secret inputs.
- Use `node scripts/pp5-webhook-probe.mjs list` to enumerate signed staging webhook probes.

### Priority 1 — External environment split (parallelizable by provider)

- Execute provider lanes from [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md).
- Split inbound webhooks per provider:
  - Stand up dedicated staging webhook destinations to `https://staging-phynd.app/api/webhooks/<provider>`.
  - Regenerate and install fresh staging webhook secrets for each provider.
  - Keep prod destination registrations intact.
- Split outbound PhyndCRM → Karafiel target to staging endpoint:
  - `KARAFIEL_API_URL=https://staging-karafiel.madfam.io` in `phynd-crm-staging-secrets`.
  - Distinct staging `KARAFIEL_WEBHOOK_SECRET` + `KARAFIEL_API_KEY`.
- Split provider read endpoints and keys as available:
  - Janua/Telemetry, Dhanam, Cotiza, Pravara, Forj, Tezca, Karafiel.
- Keep existing prod values out of all staging env vars marked “split-sensitive” (webhooks, API keys, outbound auth tokens).

### Priority 2 — Staging ingress/bootstrap (blocking for operational verification)

- Add Cloudflare/tunnel route for `staging-phynd.app` and point to `phynd-crm-staging` app.
- Validate DNS, TLS, and `/api/health` reachable by external monitor.
- Add staging app URL and webhook callback URLs in downstream services that now expose a staging consumer endpoint.

### Priority 3 — Data safety guardrails (blocking for confidence, not code)

- Implemented interim staged fallback: nightly deterministic `pnpm pp5:staging-reset`
  + `pp5:data-safety` execution at 03:00 UTC via
  `.github/workflows/pp5-staging-refresh.yml`; replace with true masked prod→staging
  restore once approved by RFC 0001.
- Ensure PII is sanitized before restore and staging fixture path is deterministic.
- Include tablaco fixture + demo-mode safety checks in seed or restore checks.

### Priority 4 — Post-PP.5 hardening (non-blocking backlog)

- `EMAIL_ALLOWLIST_DOMAINS` guard is implemented in `apps/worker/src/processors/email-drip.ts` to block non-allowlisted recipients when set.
- Tighten production/staging replica and resource policy review when volume rises.
- Track pending RFC 0001 deviations and delete temporary documentation caveats when providers complete staging stacks.

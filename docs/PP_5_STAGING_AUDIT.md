# PP.5 — PhyneCRM staging audit vs RFC 0001

> Last Updated: 2026-04-17
> RFC: [internal-devops/rfcs/0001-dev-staging-prod-pipeline.md](https://github.com/madfam-org/internal-devops/blob/main/rfcs/0001-dev-staging-prod-pipeline.md)
> Runbook: [internal-devops/runbooks/staging-bootstrap.md](https://github.com/madfam-org/internal-devops/blob/main/runbooks/staging-bootstrap.md)
> Reference impl: [karafiel PP.1 — `infra/k8s/overlays/staging/`](https://github.com/madfam-org/karafiel/tree/main/infra/k8s/overlays/staging)
> Precedents: [dhanam PP.2](https://github.com/madfam-org/dhanam/blob/main/docs/PP_2_STAGING_AUDIT.md), [janua PP.3](https://github.com/madfam-org/janua/blob/main/docs/PP_3_STAGING_AUDIT.md)
> Scope: audit only — this PR ships the document + a CLAUDE.md cross-reference. Structural and promotion-workflow convergence is **deferred** to PP.5b / PP.5c.

## TL;DR

PhyneCRM has **no staging environment today**. Every push to `main` that
touches `apps/web/**` or `apps/worker/**` triggers `deploy-web.yml` or
`deploy-worker.yml`, which build an image, cosign-sign it, and commit the
digest directly into `infra/k8s/production/kustomization.yaml`. ArgoCD /
Enclii reconciles straight into prod. This is the same single-tier shape
Janua is in, with a broader blast radius: PhyneCRM is the seam across the
MADFAM webhook graph (6 inbound providers + Karafiel + Fortuna + Tezca +
RouteCraft; outbound to Karafiel).

Compliance against RFC 0001: **~15%**. Of 21 audited rows, 2 are aligned
(prod replica counts by intent, namespace convention by planning), 1 is
an intentional deviation, 13 are diverged (scope of PP.5b / PP.5c), and 3
are deferred. Both follow-up PRs are required.

The four shapes that most differ from RFC 0001:

1. **No staging anything.** No `phyne-crm-staging` namespace, no
   `infra/k8s/overlays/` directory (only `infra/k8s/production/`), no
   staging ArgoCD Application, no `staging-crm.madfam.io` subdomain.
2. **No `.enclii.yml` in the repo.** Unlike Dhanam / Janua, PhyneCRM has
   no Enclii config file at all — RFC 0001's `promotion:` key has no
   file to land in yet.
3. **No promote / rollback workflows.** Rollback = `git revert` + wait
   for re-reconcile; nowhere near RFC's <5 min RTO.
4. **Cross-service webhook pipeline is environment-agnostic.** PhyneCRM's
   inbound + outbound webhook URLs point at prod only. See § PhyneCRM-
   specific staging constraints.

## Current state vs RFC 0001 — row-by-row

| # | Area | RFC 0001 expects | PhyneCRM today | Status | Resolution |
|---|---|---|---|---|---|
| 1 | Env-agnostic base | `infra/k8s/base/` | `infra/k8s/production/` plays both base and overlay (digests baked in) | Diverged | PP.5b: Karafiel pattern — keep `production/` as canonical base, add `overlays/staging/` referencing `../../production`. |
| 2 | `infra/k8s/` location | `infra/k8s/{base,overlays/{staging,production}}` | `infra/k8s/production/` at repo root | Intentional deviation (RFC-compliant path; only nesting is missing) | PP.5b adds `overlays/` subdir; no relocation. |
| 3 | Staging overlay exists | `overlays/staging/kustomization.yaml` with staging patches | Does not exist | Diverged | PP.5b: create with `resources: [../../production]`, replicas=1, staging env / secrets / ingress patches. |
| 4 | Both apps in staging | web + worker covered | Both in prod, neither in staging | Diverged | PP.5b: staging overlay patches both. Web handles inbound webhooks; worker runs drip / scoring / demo-cleanup jobs — must soak together. |
| 5 | Image pinning (prod) | Digest written by promote workflow only | `deploy-{web,worker}.yml` commit digest directly to `infra/k8s/production/kustomization.yaml` on push | Diverged | PP.5b: switch digest-write target to `overlays/staging/`. Prod digest via `promote-to-prod.yml` in PP.5c. |
| 6 | Image pinning (staging) | Digest written by `build-and-deploy-staging.yml` | N/A | Diverged | PP.5b: rename existing workflows (or add siblings) to write to `overlays/staging/`. |
| 7 | Promote workflow | `promote-to-prod.yml` (`workflow_dispatch`) | Does not exist | Diverged → PP.5c | Pattern B (manual gate) — see § Promotion pattern. |
| 8 | Rollback workflow | `rollback-prod.yml`, RTO <5 min | Does not exist; rollback = `git revert` | Diverged → PP.5c | Target-digest input, default to previous prod digest from git history. |
| 9 | Soak period before promote | ≥30 min, smoke-pass required | N/A | Deferred → PP.5c | |
| 10 | ArgoCD staging Application | `phyne-crm-staging` App watches `overlays/staging/` | Does not exist (phyne-crm has no in-repo ArgoCD manifest — prod App lives in the Enclii repo) | Diverged | PP.5b: ship `infra/argocd/phyne-crm-staging-application.yaml` (Dhanam PP.2b precedent) to co-locate source of truth. |
| 11 | Staging namespace | `<service>-staging` | Does not exist. Only `phyne-crm` (prod). | Diverged | PP.5b ops action: `kubectl create namespace phyne-crm-staging`. |
| 12 | Staging subdomain / ingress | `staging-<service>.<domain>` | No Ingress resources today (traffic via Enclii cloudflared tunnel → `crm.madfam.io`) | Diverged | PP.5b + Cloudflare ops: add tunnel route `staging-crm.madfam.io` → `phyne-crm-web.phyne-crm-staging.svc.cluster.local:80`. No Ingress needed; stays consistent with prod topology. |
| 13 | Staging smoke test | Curl retry against `staging-<domain>/health` | None. `/api/health` exists but only Docker HEALTHCHECK uses it. | Diverged | PP.5b: 6×20s curl-retry against `https://staging-crm.madfam.io/api/health`. Worker: `kubectl rollout status` (no HTTP endpoint). |
| 14 | Replica counts (staging) | 1 per deploy | N/A | Diverged | PP.5b: `replicas: 1` for web + worker. No HPAs in phyne-crm, so no HPA-disable patch needed. |
| 15 | Replica counts (prod) | 2-N per deploy, HPAs tuned | web + worker both `replicas: 1` (deliberate cost choice for a low-traffic internal-ish CRM) | Aligned enough (intentional deviation) | Keep. Flag for review when customer count grows. |
| 16 | Staging namespace convention | `<service>-staging` | PP.5b target: `phyne-crm-staging` | Aligned (by planning) | Document. |
| 17 | Staging secrets template | Separate `<service>-staging-secrets` covering all env vars | N/A. Prod uses `phyne-crm-secrets` + `phyne-acca-secrets`. | Diverged | PP.5b: add `infra/k8s/staging-secrets-template.yaml` covering ~30 keys (DB, Redis, Auth.js, Janua, Dhanam, Cotiza, Pravara, Forj, Tezca, Karafiel, Fortuna, AutoSwarm / OpenAI, Resend, Reddit, federation token). Sandbox keys only — never reuse prod secrets. |
| 18 | External service sandbox | Staging Janua tenant, test OAuth clients, sandbox webhook secrets per provider | N/A — all 9 provider webhook URLs point at prod PhyneCRM only | Diverged | PP.5b + ops. Full matrix in § PhyneCRM-specific constraints below. |
| 19 | DB: nightly masked restore | 03:00 UTC prod→staging PII-masked | Not implemented | Deferred (RFC 0001 open question) | Seed staging with `pnpm db:seed` (including tablaco fixtures) until masking tool lands. PhyneCRM holds contact / lead PII that must never leak unmasked. |
| 20 | Promotion pattern declaration | `.enclii.yml` `promotion:` key | **No `.enclii.yml` or `enclii.yaml` exists at all** | Diverged → PP.5c | Create minimal `.enclii.yml` with `promotion: { pattern: manual, min_soak_minutes: 30, require_smoke_pass: true }`. |
| 21 | Decommission bypass path | Phase 4 removal of direct-to-prod commits after 14-day soak | N/A — current pipeline IS the bypass | Deferred → post-PP.5c | Trim `deploy-{web,worker}.yml` direct-to-prod commits after 14-day soak. |

## Summary

| Classification | Count | Rows |
|---|---|---|
| Aligned | 2 | 15, 16 |
| Intentional deviation | 1 | 2 |
| Diverged — PP.5b (structural) | 10 | 1, 3, 4, 5, 6, 10, 11, 12, 13, 14, 17, 18 |
| Diverged — PP.5c (promote / rollback / `.enclii.yml`) | 3 | 7, 8, 20 |
| Deferred | 3 | 9, 19, 21 |

**Compliance: ~15%** — matches Janua's baseline. PP.5b (~250 LOC yaml +
~40 LOC workflow) and PP.5c (~200 LOC net, including new `.enclii.yml`)
are both required.

## PhyneCRM-specific staging constraints (flag for ops)

PhyneCRM is the seam across the MADFAM webhook graph. Its staging rollout
requires coordinated webhook wiring across every provider.

### 1. Inbound webhook pipeline must be environment-split

Every provider's webhook URL today points at `https://crm.madfam.io`. If
re-pointed wholesale to staging, test events would create real customer
rows in prod PhyneCRM. Each provider must register a **second**
destination for its staging instance with a **distinct** HMAC secret:

| Provider → PhyneCRM inbound | Today | Post-PP.5b |
|---|---|---|
| Karafiel `grant.awarded` → `/api/webhooks/karafiel` | prod → prod | prod → prod AND staging Karafiel → staging PhyneCRM |
| Fortuna `grant.discovered` → `/api/webhooks/fortuna` | prod → prod | prod → prod AND staging → staging |
| Tezca `interest.created`, `newsletter.subscribed` → `/api/webhooks/tezca` | prod → prod | prod → prod AND staging → staging |
| Janua `user.created` → `/api/webhooks/janua` | prod → prod | prod → prod AND staging → staging (unblocks on Janua PP.3b) |
| Dhanam billing → `/api/webhooks/dhanam` | prod → prod | prod → prod AND staging → staging (unblocks on Dhanam PP.2b) |
| Cotiza / Pravara / Forj federation → `/api/webhooks/{cotiza,pravara,forj}` | prod → prod | prod → prod AND staging → staging (when those services get staging) |
| RouteCraft payment attribution → `/api/webhooks/routecraft` | prod → prod | prod → prod AND staging → staging |

HMAC secrets (`KARAFIEL_WEBHOOK_SECRET`, `FORTUNA_WEBHOOK_SECRET`,
`TEZCA_WEBHOOK_SECRET`, `JANUA_WEBHOOK_SECRET`, `DHANAM_WEBHOOK_SECRET`,
`COTIZA_WEBHOOK_SECRET`, `PRAVARA_WEBHOOK_SECRET`, `FORJ_WEBHOOK_SECRET`,
`PHYNE_CRM_EVENTS_SECRET` for RouteCraft) MUST be distinct per env —
never reuse prod values in staging, never cross-wire.

### 2. Outbound webhook (PhyneCRM → Karafiel) needs the same split

PhyneCRM dispatches `grant.awarded` to Karafiel when a grant application
reaches "Awarded". Staging `phyne-crm-secrets-staging` must set
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
emit staging events only for test emails. Consider adding
`EMAIL_ALLOWLIST_DOMAINS` to `apps/worker/src/processors/email-drip.ts`
as belt-and-suspenders (hardening backlog).

### 5. Demo mode on staging

`/demo` seeds ~63 rows per session with a 1h `demo-cleanup` BullMQ job.
Staging DB sizing should account for demo churn. Staging Redis must be
distinct from prod Redis (queue isolation).

### Secret generation matrix (PP.5b operator checklist)

| Key | Generation |
|---|---|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `{JANUA,DHANAM,COTIZA,PRAVARA,FORJ,TEZCA,KARAFIEL,FORTUNA}_WEBHOOK_SECRET` | `openssl rand -base64 32` each |
| `PHYNE_CRM_EVENTS_SECRET` | `openssl rand -base64 32` |
| `FEDERATION_API_TOKEN` | `openssl rand -base64 48` |
| `AUTH_JANUA_CLIENT_ID` / `SECRET` | Register staging OAuth client with staging Janua; redirect URI `https://staging-crm.madfam.io/api/auth/callback/janua` |
| `DATABASE_URL` | Points at `phyne_crm_staging` DB, distinct role |
| `REDIS_URL` | Distinct staging Redis instance |
| `RESEND_API_KEY` | Domain-scoped staging key |
| `NEXT_PUBLIC_APP_URL` | `https://staging-crm.madfam.io` |

Add a `phyne-crm-staging` entry to `janua/infra/secrets/SECRETS_REGISTRY.yaml`
when PP.5b opens.

## Promotion pattern

PhyneCRM is **Pattern B — manual gate** per RFC 0001 § Promotion
mechanics. Reasoning: PhyneCRM owns the ACCA Treasury Hunter HITL
approval queue + the customer lead pipeline + the `conversions` table
(partial unique constraints). A wrong promote can corrupt active grant
applications or silently break the drip worker. When PP.5c ships,
`.enclii.yml` will declare:

```yaml
promotion:
  pattern: manual
  min_soak_minutes: 30
  require_smoke_pass: true
```

## What PP.5 (this PR) ships

1. **This audit document** (`docs/PP_5_STAGING_AUDIT.md`).
2. **CLAUDE.md update** — "Deployment Pipeline" section cross-referencing
   RFC 0001, the runbook, and this audit doc.
3. **No YAML, workflow, `.enclii.yml`, or secret changes.** Follow-ups:
   - **PP.5b — Structural** (~250 LOC yaml + ~40 LOC workflow): overlay
     structure, staging secrets template, ArgoCD Application manifest,
     staging HTTP smoke, switch digest-writes to `overlays/staging/`.
   - **PP.5c — Promote + rollback + `.enclii.yml`** (~200 LOC net):
     `promote-to-prod.yml`, `rollback-prod.yml`, minimal `.enclii.yml`,
     Phase 4 direct-to-prod trim (deferred to post-14-day soak).

Split rationale matches PP.2 / PP.3 precedent: each diff reviewable and
reversible; never change prod and staging behavior in the same PR.

## What currently ships on push to `main`

| Workflow | Trigger | Effect |
|---|---|---|
| `ci.yml` | PR + push to main | lint + typecheck + test → build |
| `e2e.yml` | PR + push to main | Playwright E2E with Postgres/Redis services |
| `deploy-web.yml` | push to main (apps/web/**, packages/**, pnpm-lock.yaml) | Builds `ghcr.io/madfam-org/phyne-crm/web`, cosign-signs, commits digest to `infra/k8s/production/kustomization.yaml`, Enclii lifecycle callback |
| `deploy-worker.yml` | push to main (apps/worker/**, packages/**, pnpm-lock.yaml) | Same shape for worker |

This flow is intentionally preserved unchanged by PP.5.

## Cross-references

- RFC 0001 — `internal-devops/rfcs/0001-dev-staging-prod-pipeline.md`
- Runbook — `internal-devops/runbooks/staging-bootstrap.md`
- Reference impl — `karafiel/infra/k8s/overlays/staging/kustomization.yaml` (PP.1)
- PP.2 precedent — `dhanam/docs/PP_2_STAGING_AUDIT.md`
- PP.3 precedent — `janua/docs/PP_3_STAGING_AUDIT.md`
- Secrets registry — `janua/infra/secrets/SECRETS_REGISTRY.yaml` (PP.5b will add `phyne-crm-staging` entry)
- Tunnel routing — `enclii/infra/k8s/production/cloudflared-unified.yaml` (PP.5b ops action: add `staging-crm.madfam.io` route)
- This PR — `feat/pp-5-phyne-crm-staging-audit`
- Follow-up PRs — PP.5b (structural), PP.5c (promote/rollback + `.enclii.yml`)

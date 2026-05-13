# PP.5 Provider Handoff Matrix

> Last Updated: 2026-05-07
> Parent audit: [`docs/PP_5_STAGING_AUDIT.md`](./PP_5_STAGING_AUDIT.md)
> Full remediation plan: [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md)
> Execution runbook: [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md)
> Session wrap-up: [`docs/PP_5_SESSION_WRAPUP_2026_05_07.md`](./PP_5_SESSION_WRAPUP_2026_05_07.md)
> Staging base URL: `https://staging-phynd.app`
> Staging namespace: `phynd-crm-staging`
> Staging secret: `phynd-crm-staging-secrets`

## Purpose

This matrix turns PP.5's remaining operational work into parallel handoffs.
Each lane has one receiving contract, one owning team, the exact PhyndCRM
staging env surface, and the acceptance checks needed before promotion
confidence resets.

Non-negotiables:

- Do not reuse production secrets in staging.
- Do not replace production webhook destinations; add staging destinations.
- Do not point staging PhyndCRM at production write endpoints unless the key is
  explicitly read-only and the deviation is documented.
- Do not allow staging email drips to real prospects; set
  `EMAIL_ALLOWLIST_DOMAINS`.

## Global Gates

| Gate | Owner | Command / check | Pass condition |
|---|---|---|---|
| Secret template coverage | PhyndCRM | `node scripts/pp5-staging-audit.mjs` | Required split-sensitive keys and observed webhook/event secrets are present. |
| Synthetic webhook probes | PhyndCRM + provider owners | `node scripts/pp5-webhook-probe.mjs list` | Every active inbound lane has a signed probe generator. |
| App health | Platform / Enclii | `curl -fsS https://staging-phynd.app/api/health` | Returns HTTP 200 with service payload. |
| Staging secret installed | Secrets owner | `kubectl -n phynd-crm-staging get secret phynd-crm-staging-secrets` | Secret exists and was generated from staging-only values. |
| ArgoCD sync | Platform / Enclii | ArgoCD app `phynd-crm-staging` | App is synced and healthy. |
| Prod isolation | Provider owner + PhyndCRM | Send staging synthetic event, inspect prod | Staging event creates no prod rows, jobs, payments, emails, or external artifacts. |

Current Wave 0 status observed on 2026-05-07:

- `PASS`: local secret-template coverage, env generation, and probe generator are ready.
- `PASS`: Kubernetes namespace `phynd-crm-staging` exists.
- `PASS`: `node scripts/pp5-wave0-check.mjs` provides a consolidated readiness check.
- `BLOCKED`: `staging-phynd.app` does not resolve.
- `BLOCKED`: ArgoCD Application `phynd-crm-staging` is not installed.
- `BLOCKED`: staging secret `phynd-crm-staging-secrets` is not installed.

## Execution Waves

| Wave | Scope | Parallelism | Exit criteria |
|---|---|---|---|
| 0 | Platform bootstrap | Platform can run independently | DNS/tunnel, ArgoCD, staging secret, `/api/health`, Enclii callbacks. |
| 1 | Low-mutation inbound providers | Janua telemetry, Cotiza, Forj can run in parallel | Signed staging webhook returns 200; invalid/prod secret returns 401; cache invalidation path does not error. |
| 2 | Mutating inbound providers | Janua, Tezca, Dhanam, Fortuna, Pravara, RouteCraft, CEQ, Coforma can run by provider | Expected staging DB rows/jobs/audit entries exist; prod remains unchanged. |
| 3 | Outbound integrations | Karafiel, Cotiza, Dhanam can run after their staging receivers are ready | PhyndCRM staging sends only to staging provider endpoints with staging secrets. |
| 4 | Data refresh | DB/platform after provider split risk drops | Nightly masked restore or deterministic staging seed path is approved. |

## Inbound Webhook Handoffs

| Lane | Provider owner | PhyndCRM staging receiver | Env keys in PhyndCRM | Provider changes | Acceptance check | Status |
|---|---|---|---|---|---|---|
| Janua user lifecycle | Janua | `POST /api/webhooks/janua` | `JANUA_WEBHOOK_SECRET`, `JANUA_API_URL` | Add staging `user.created` destination with a fresh staging HMAC secret. Keep prod destination intact. | Send staging `user.created`; PhyndCRM creates or links a staging contact by email / Janua ID; replay is idempotent by existing contact lookup. | External handoff |
| Janua OIDC / portal auth | Janua | `GET /api/auth/callback/janua`, portal JWKS / magic-link calls | `AUTH_JANUA_ISSUER`, `AUTH_JANUA_CLIENT_ID`, `AUTH_JANUA_CLIENT_SECRET`, `JANUA_API_URL`, `PORTAL_BASE_URL` | Register staging OAuth client and magic-link redirect `https://staging-phynd.app/api/auth/callback/janua`; expose staging JWKS/API. | Staff login works in staging; portal magic link verify rejects mismatched email and accepts staging Janua token issuer. | External handoff |
| Janua telemetry | Janua telemetry | `POST /api/webhooks/janua-telemetry` | `JANUA_TELEMETRY_WEBHOOK_SECRET`, `JANUA_TELEMETRY_API_URL` | Add staging telemetry webhook using distinct secret. No fallback to `JANUA_WEBHOOK_SECRET` is allowed in service code. | Send `externalSessionId` + `pageViews`; staging page-view rows persist when session exists; invalid signature returns 401. | External handoff |
| Dhanam billing | Dhanam | `POST /api/webhooks/dhanam` | `DHANAM_WEBHOOK_SECRET`, `DHANAM_API_URL` | Add staging billing relay destination with `X-Dhanam-Signature`; use sandbox billing data only. | Send paid, failed, refunded, disputed, and cancelled events; PhyndCRM writes `webhook_events`, conversions, optional referral/lead updates for paid events, order payment reconciliation/lifecycle references, and engagement timeline events in staging only. | External handoff |
| Cotiza federation cache | Cotiza | `POST /api/webhooks/cotiza` | `COTIZA_WEBHOOK_SECRET`, `COTIZA_API_URL` | Add staging webhook destination with fresh secret; expose staging read API or read-only documented fallback. | Signed event returns 200 and invalidates Cotiza federation cache without prod side effects. | External handoff |
| Pravara fabrication | Pravara | `POST /api/webhooks/pravara` | `PRAVARA_WEBHOOK_SECRET`, `PRAVARA_BASE_URL`, `PRAVARA_API_KEY`, optional `PRAVARA_DISPATCH_URL` | Add staging fabrication status destination with fresh secret and expose production-dispatch receiver. | Send status update for staging external reference; PhyndCRM records activity and engagement event if linked. Paid physical order dispatch reaches Pravara staging. | External handoff |
| Forj assets | Forj | `POST /api/webhooks/forj` | `FORJ_WEBHOOK_SECRET`, `FORJ_API_URL` | Add staging asset/event destination with fresh secret; expose staging asset API or read-only fallback. | Signed event returns 200 and invalidates Forj federation cache; no prod asset mutation. | External handoff |
| Tezca interests/newsletter | Tezca | `POST /api/webhooks/tezca` | `TEZCA_WEBHOOK_SECRET`, `TEZCA_API_URL`, `TEZCA_PUBLIC_URL`, `RESEND_API_KEY`, `EMAIL_ALLOWLIST_DOMAINS` | Add staging `interest.created` and `newsletter.subscribed` destination with fresh secret; emit only test emails. | Contact + lead created in staging; `email-drip` job queued; non-allowlisted recipient is skipped by worker. | External handoff |
| Fortuna grants | Fortuna | `POST /api/webhooks/fortuna` | `FORTUNA_WEBHOOK_SECRET`, `FORTUNA_API_KEY`, `KARAFIEL_API_URL`, `KARAFIEL_API_KEY` | Add staging `grant.discovered` destination with fresh `X-Fortuna-Signature`. | Grant opportunity/application created in staging; compliance-check job targets staging Karafiel API. | External handoff |
| RouteCraft attribution | RouteCraft | `POST /api/webhooks/routecraft` | `PHYND_CRM_EVENTS_SECRET` | Add staging payment attribution destination with `x-madfam-signature`. | Staging event writes `webhook_events` and `ecosystem_payment_succeeded` conversion; duplicate event is accepted as duplicate. | External handoff |
| Legacy ecosystem payment event | RouteCraft / ecosystem | `POST /api/v1/events/payment.succeeded` | `PHYND_CRM_EVENTS_SECRET` | Keep only if producers still emit this legacy endpoint; otherwise mark deprecated after RouteCraft cutover. | Synthetic probe payment returns 200 and writes staging audit/conversion where probe lead exists. | Confirm owner |
| CEQ interest gate | CEQ | `POST /api/webhooks/ceq` | `CEQ_WEBHOOK_SECRET`, `EMAIL_ALLOWLIST_DOMAINS` | Add staging interest destination with fresh secret and test-only emails. | Contact + lead created; optional UTM conversion recorded; drip obeys allowlist. | External handoff |
| Coforma CAB | Coforma | `POST /api/webhooks/coforma` | `COFORMA_WEBHOOK_SECRET` | Add staging CAB destination with `x-madfam-signature`, `idempotency-key`, and `x-coforma-tenant-id`. | CAB join/exit event records audit row and links/unlinks staging contact when match exists. | External handoff |
| Engagement events | Cotiza / Pravara / Selva / Karafiel / Dhanam | `POST /api/v1/engagements/events` | `PHYND_ENGAGEMENT_EVENTS_SECRET` | Add staging event destination for project milestone/status writes. | Event with `engagement_id`, `source`, `event_type` records timeline entry; duplicate `dedup_key` dedupes. Paid order dispatch intent creates `system:production_dispatch_requested`, and worker dispatch emits sent/failed timeline events. | External handoff |
| Engagement artifacts | Cotiza / Karafiel / Dhanam / Selva | `POST /api/v1/engagements/artifacts` | `PHYND_ENGAGEMENT_EVENTS_SECRET` | Add staging artifact destination for signed proposal, invoice, deliverable, NFT receipt links. | Artifact appears in staging portal timeline/artifact view for the engagement. | External handoff |

## Outbound Handoffs

| Lane | Receiver owner | PhyndCRM emitter | Env keys in PhyndCRM | Receiver changes | Acceptance check | Status |
|---|---|---|---|---|---|---|
| Grant awarded to Karafiel | Karafiel | `POST ${KARAFIEL_API_URL}/webhooks/phynd-crm` from `dispatchGrantAwarded()` | `KARAFIEL_API_URL`, `KARAFIEL_WEBHOOK_SECRET` | Expose staging receiver at `https://staging-karafiel.madfam.io/webhooks/phynd-crm`; install staging HMAC secret. | Award a staging grant; Karafiel staging receives `grant.awarded`; no prod Karafiel rows are created. | External handoff |
| Karafiel compliance reads | Karafiel | Worker `grant-compliance-check` reads `${KARAFIEL_API_URL}/grants/compliance-status/{rfc}/` | `KARAFIEL_API_URL`, `KARAFIEL_API_KEY` | Expose staging compliance API with staging bearer key. | Fortuna staging event enqueues compliance job; worker reads staging Karafiel and records compliance status. | External handoff |
| Engagement projection to Cotiza | Cotiza | `POST ${COTIZA_API_URL}/api/v1/webhooks/phyndcrm/engagements` | `COTIZA_API_URL`, `PHYNDCRM_OUTBOUND_SECRET`, `COTIZA_WEBHOOK_TIMEOUT` | Install staging `PHYNDCRM_INBOUND_SECRET` on Cotiza receiver and staging URL in PhyndCRM. | Create/update/archive staging engagement; Cotiza staging receives projection; PhyndCRM write is not blocked if Cotiza is unavailable. | External handoff |
| Quote checkout to Dhanam | Dhanam | `POST ${DHANAM_API_URL}/v1/checkout/sessions` from portal checkout | `DHANAM_API_URL`, `DHANAM_WEBHOOK_SECRET` | Expose staging checkout-session receiver and accept `X-PhyndCRM-Signature`. | Portal accepts a staging quote, PhyndCRM records a Dhanam checkout external reference + invoice artifact, and Dhanam staging returns a sandbox checkout URL. | External handoff |
| Referral reward to Dhanam | Dhanam | `POST ${DHANAM_API_URL}/v1/referral/reward` from worker | `DHANAM_API_URL`, `DHANAM_WEBHOOK_SECRET` | Expose staging reward receiver and accept `X-PhyndCRM-Signature`. | Convert staging referral; Dhanam staging receives reward request; no real reward is applied. | External handoff |
| Paid physical production dispatch | Pravara | `POST ${PRAVARA_DISPATCH_URL}` or `${PRAVARA_BASE_URL}/api/v1/fabrication/dispatches` from worker `production-dispatch` | `PRAVARA_BASE_URL`, `PRAVARA_API_KEY`, optional `PRAVARA_DISPATCH_URL`, `PRAVARA_DISPATCH_SECRET` | Expose staging dispatch receiver and enforce receiver idempotency on `dispatch_id` or `Idempotency-Key`. | Fully pay a fabrication/fulfillment order; external reference metadata becomes `dispatch_status=sent`; Pravara staging receives one dispatch. | External handoff |
| Paid digital/phygital production dispatch | Selva | `POST ${SELVA_DISPATCH_URL}` or `${SELVA_API_URL}/api/v1/projects/dispatches` from worker `production-dispatch` | `SELVA_API_URL`, `SELVA_API_KEY` or `SELVA_DISPATCH_SECRET`, optional `SELVA_DISPATCH_URL` | Expose staging dispatch receiver and enforce receiver idempotency on `dispatch_id` or `Idempotency-Key`. | Fully pay a digital twin/kiosk/digital experience order; external reference metadata becomes `dispatch_status=sent`; Selva staging receives one dispatch. | External handoff |

## Provider API Read Split

| Provider | Env key | Preferred staging value | Temporary fallback if staging API is unavailable | Acceptance check |
|---|---|---|---|---|
| Janua | `JANUA_API_URL` | Staging Janua API / issuer-aligned URL | No fallback for auth-critical paths; block until staging Janua is available. | Login, JWKS verify, magic link all use staging issuer. |
| Janua telemetry | `JANUA_TELEMETRY_API_URL` | Staging telemetry API | Fall back to `JANUA_API_URL` only if both represent staging. | Visitor/federation telemetry reads do not hit prod. |
| Dhanam | `DHANAM_API_URL` | Staging Dhanam API | Read-only prod key only with documented deviation; no writes. | Billing federation card loads staging/sandbox data. |
| Cotiza | `COTIZA_API_URL` | Staging Cotiza API | Return unavailable or use read-only prod key with documented deviation. | Quote/proposal federation cards avoid prod writes. |
| Pravara | `PRAVARA_BASE_URL` | Staging MES API | Return unavailable until staging MES exists. | Fabrication card shows staging/test records only. |
| Forj | `FORJ_API_URL` | Staging Forj API | Read-only prod key only if no asset mutation is possible. | Asset card loads staging/test assets only. |
| Tezca | `TEZCA_API_URL` | Staging Tezca API | Return unavailable; do not crawl/prospect prod from staging. | Legal/interest views avoid prod prospect data. |
| Karafiel | `KARAFIEL_API_URL` | `https://staging-karafiel.madfam.io` | No fallback for grant/compliance write paths. | Grant award/compliance flows never hit prod Karafiel. |

## Known Gaps To Resolve Before Signoff

| Gap | Owner | Resolution |
|---|---|---|
| No implemented `POST /api/webhooks/karafiel` receiver exists in this repo. | PhyndCRM + Karafiel | Treat Karafiel PP.5 scope as outbound PhyndCRM to Karafiel unless a real inbound Karafiel-to-PhyndCRM contract is added. |
| Staging DNS/tunnel route is not in this repo. | Platform / Enclii | Add `staging-phynd.app` route to the cluster service and external monitor. |
| Nightly masked prod-to-staging restore is not implemented. | Platform / DB | Add masked restore or approved deterministic seed + fixture baseline before broad provider testing. |
| Regression: `JANUA_TELEMETRY_WEBHOOK_SECRET` fallback to `JANUA_WEBHOOK_SECRET` reintroduced in service or env. | Janua telemetry + PhyndCRM | `node scripts/pp5-stability-check.mjs` and code-level checks block this regression; keep a distinct `JANUA_TELEMETRY_WEBHOOK_SECRET` configured. |

## Handoff Ticket Template

Use one ticket per lane.

```md
## PP.5 staging handoff - <provider/lane>

Owner:
Provider repo/service:
PhyndCRM receiver/emitter:
Staging URL:
Env keys:
Secret generation date:
Producer/receiver change:
Synthetic event or workflow:
Expected PhyndCRM result:
Expected provider result:
Prod isolation evidence:
Rollback plan:
Completion date:
```

# SSO / Lead-Flow Incident — 2026-08-12

Evidence record, same convention as the other dated docs: what broke, what was
proven, what shipped, what remains. All times UTC.

## Symptom

Operator clicked **"Abrir en el CRM"** in a nauta lead-notification email.
Sign-in at auth.madfam.io appeared to do nothing (spinner, same page). After
partial fixes, sign-in completed but the lead page rendered the error
boundary ("Something went wrong").

One flow, **three independent defects stacked**. Each was root-caused from
production evidence before fixing; each fix is regression-tested and was
verified live.

## Defect 1 — email deep link targeted the legacy domain (#77)

- The notification email built its CRM link from
  `NEXT_PUBLIC_APP_URL ?? 'https://crm.madfam.io'`. `NEXT_PUBLIC_*` is baked
  at image build time (`docker/Dockerfile.web` build-arg) and still said
  `crm.phynd.app`, so the fallback never fired and the operator was routed to
  the legacy host.
- Janua logs proved the whole OAuth flow ran with
  `redirect_uri=https://crm.phynd.app/...` (initial authorize 17:54:48, post-
  login replay 17:55:52, redis-expiry recovery 17:56:27 — the recovery path
  rebuilds from the client's **first registered** redirect URI, which was the
  legacy one).
- Fix: lead-email links use the canonical host as a **constant** — not the
  build-baked env, not the request host (either can smuggle a legacy alias
  into email). Regression test pins the legacy env being set while the link
  stays canonical. `/login` now renders Auth.js `?error=` as a visible
  banner (failures used to re-render an identical page — "Sign in does
  nothing"), and the auth wall carries the destination through
  `/login?next=…` with `safeNextPath()` (CWE-601 validation) so email links
  land on the record, not `/overview`.
- Janua-side (operator-run, `internal-devops/scripts/janua-fix-phynd-client.sh`):
  client display name `Phynd CRM Production Vault 20260518041324` → `Phynd
  CRM`; `redirect_uris` reordered so `crm.madfam.io` is first (the recovery
  path uses `redirect_uris[0]`). No URIs removed.

## Defect 2 — one auth request poisoned the pod's env (#79)

- `withRequestAuthOrigin` restored `AUTH_URL`/`NEXTAUTH_URL` by **assigning
  `undefined`** — `process.env` coerces that to the string `"undefined"`.
  After the first `[...nextauth]` request on any pod, Auth.js
  `createActionURL` saw a truthy configured URL and did
  `new URL("undefined")` → every later `auth()` threw `Invalid URL` (prod
  digests `847812227`, `1509613992`). The OAuth callback itself succeeded
  (the wrapper holds a valid origin during its own execution), so the crash
  always landed on the first authenticated render — and was masked upstream
  as `?error=Configuration` on both hosts.
- Fix: `delete`, the only way to unset an env key. **Biome's
  `lint/performance/noDelete` suggested replacement (`= undefined`) is
  exactly this bug** — suppressed inline with the reason.
- Diagnosed by pulling the minified vendor chunk from the pod and slicing at
  the stack-trace offsets; `input: 'undefined'` (a quoted string) only fits
  the env-coercion path.
- Verified live without credentials: 3× the auth route (old poison trigger),
  then a dashboard render via the demo flow (`resolveAuthContext` calls
  `auth()` unconditionally) — no error boundary.
- Known, documented, unfixed: the wrapper mutates process-global env, so
  concurrent requests on different hosts can observe each other's origin for
  the overlap. Correct per-request plumbing through Auth.js config is a
  larger change.

## Defect 3 — routers rejected the app's own seeded ids (#81)

- Pipeline/stage ids are **slugs by design**: the production seed creates
  `pipeline_default_sales` / `stage_default_new`, and the demo seeder mints
  `demo-<uuid>-pipeline` at runtime. Yet 23 procedure inputs across 7 routers
  validated them with `z.string().uuid()` — `BAD_REQUEST` before any service
  code ran. Every pipeline/stage-parameterized procedure was broken for real
  data; the first real lead's detail page exposed it
  (`ZodError invalid uuid path=pipelineId`, digest `2591049055`).
- Fix: shared `entityId` validator (`packages/api/src/validation.ts`,
  non-empty ≤255) for pipeline/stage ids only. Lead / contact / user ids are
  genuinely generated UUIDs and keep `.uuid()`. Id shape carries no
  authorization — tenancy is enforced by the service context.
- Tests run through the real router caller and are negative-controlled
  (3 fail against the old validators). Verified live: demo-session tRPC
  `pipelines.getStages` with `pipeline_default_sales` returns the stage list
  (was 400).

## Current state (end of 2026-08-12)

- Full nauta funnel verified E2E by the operator: email → canonical host →
  SSO → lead detail renders.
- All suites green on main: api 206, web 298, services 666, config 62,
  federation 129.
- Deployed digests: web `2d85fe0f…`, worker `ffff5c0f…` (pins #82).

## Residual risks / open items

- **crm.phynd.app**: RESOLVED same day — operator decided a *holding*
  redirect: browser paths 301 to `crm.madfam.io` until the first non-MADFAM
  tenant onboards; `/api/*` keeps serving; tenancy architecture untouched.
  See `DOMAIN_ROUTING_POLICY_2026-05-15.md` addendum.
- **janua#517**: `dynamic_cors.py` and `global_rate_limit.py` import a
  `get_db_session` that `app.core.database` never exported — dynamic CORS
  and the DB rate-limit path are silently degraded in janua production.
- Janua clients created by the 2026-05-18 Vault rebootstrap may carry the
  same leaked `<App> Production Vault <timestamp>` display-name suffix on
  their consent screens — audit the other clients.

## Deploy-process lessons (repo-specific)

- Production ships ONLY via the kustomize `images:` block in
  `infra/k8s/production/kustomization.yaml`. Read staging's auto-pin **by
  structure** (digest+name parsed as one entry): `digest:` precedes `name:`,
  so `grep -A2 'name:.*web'` walks into the next entry and pins the wrong
  image (#75 pinned the worker digest onto web → per-repo `NotFound` →
  ImagePullBackOff behind a still-green site).
- A `packages/api` change rebuilds **both** images — pin web and worker
  together.
- This repo has no enforced checks (free-plan private repo): `gh pr merge`
  succeeds with CI still pending. Wait for completion explicitly; a Deploy
  Web failure on main (cosign bootstrap download flake, curl exit 22) is
  rerunnable via `gh run rerun --failed`.

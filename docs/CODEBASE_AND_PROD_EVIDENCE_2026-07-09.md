# Phynd CRM codebase and production evidence

Date: 2026-07-09

Refreshes [`CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md`](./CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md).
When the two conflict, this note is the newer status; the older note remains as
history. Codebase observations below were re-derived from the repository this
session. Live production checks **were re-run later the same day** — see
§"Production verification (2026-07-09, live)" below, which supersedes the
"not re-run" caveat in the original §"Production status".

## Codebase observations (2026-07-09)

Deltas vs the 2026-05-27 baseline in parentheses.

- Tracked files: **867** (was 680).
- Documentation files under `docs/`: **46** (was 26).
- tRPC routers in `packages/api/src/router.ts`: **27** (was 25).
- Web pages (`apps/web/src/app/**/page.tsx`): **31** (unchanged).
- Web route handlers (`route.ts`): **48** (was 34) — the growth is the
  event/campaign surface (RouteCraft `trip.attributed`, Cotiza intake, Selva
  buyer-signal, campaign send/consent).
- Drizzle migrations: `0000` → **`0012_yellow_proemial_gods.sql`** (was `0007`).
- Test files (`*.test.ts(x)` / `*.spec.ts`): **134** (was 109).
- Feature flags in `packages/config/src/features.ts`: **14** (unchanged).
- Federation providers (read seam): **6** — janua, janua-telemetry, dhanam,
  cotiza, pravara, forj (unchanged), each with a contract test.
- Worker processors now include the campaign/event lanes (`reddit-bot`,
  `email-drip`, `referral-reward-dispatch`, `production-dispatch`,
  `grant-compliance-check`, `session-identify`, `task-reminders`, `poll-subreddits`,
  plus the core `federation-sync`/`cache-warmup`/`health-check`).

## GitHub / delivery state (2026-07-09)

- **0 open PRs, 0 open issues** at audit time; high merge cadence 07-04 → 07-09.
- Recent feature merges: `#43` AGPL-3.0, `#44` LFPDPPP consent + suppression +
  Resend tracking, `#45` Selva draft-variant handoff, `#46` `attemptTulanaSend`
  dispatch, `#47` Cotiza quote intake, `#48` Selva buyer-signal pusher, `#49`
  RouteCraft `trip.attributed` receiver, `#50` dual-secret webhook rotation.
- **Deploy Web / Deploy Worker: consistently green.**
- **Nightly `PP5 Staging Refresh`: was failing every run** (07-04 → 07-09) on a
  `pnpm/action-setup` version pin conflicting with `packageManager` — fixed on
  branch `claude/phyndcrm-audit-remediation` (turns green once merged to `main`).

## Reconciled scorecard (supersedes the single-number snapshots)

The README's "~25–35%" and the ROADMAP's "~55–62%" were **two different axes
reported as one number**, which read as a contradiction. Use the two-axis view:

| Axis | What it measures | 2026-07-09 |
| --- | --- | --- |
| **Capability built (code)** | Routers, federation seam, campaign loop, Selva agent surface implemented + tested | **~80–85%** |
| **Truthful-in-prod / pilot-ready** | Live truthful ecosystem data (all SKUs, visitors, agent sales), no mock fallback, staff SSO verified | **~30–55%** by dimension |

The "~25–35%" figure was the *truthful-ecosystem-data* axis at 2026-05-27; the
"~55–62%" figure was the *composite* at 2026-05-28. Neither was wrong; they were
comparing different things. Going forward, cite the axis, not a lone percentage.
The remaining distance to the north star is dominated by **ops execution and
prod verification**, not missing code.

## Production status

Live checks were **not** re-run in this session. The most recent recorded prod
evidence is the 2026-05-27 note (phynd.app 200, crm.madfam.io login, enclii
project healthy). Before the next pilot, an operator should re-verify:

- `https://phynd.app/api/auth/providers` returns only public hosts (`pnpm verify:prod-auth`).
- Service env carries `AUTH_JANUA_ISSUER` after the `.enclii.yml` `spec.env`
  correction deploys (audit C2).
- Worker `OPENAI_BASE_URL` points at the Selva **inference-gateway** `/v1`
  (RFC 0034 P2 cutover 2026-07-07), since the reddit-bot now fails closed (C3).
- `DHANAM_API_URL` base matches the corrected `/v1/customers` path (C5).
- Janua entitlements grant `admin@madfam.io` the `admin` role now that phynd
  reads roles from the access token (C4).

## Production verification (2026-07-09, live)

Read-only external checks run ~23:30 UTC. These supersede the "not re-run"
caveat above.

### Healthy ✅

- `https://phynd.app/` and `https://www.phynd.app/` → HTTP 200 via Cloudflare
  (<1s); `/api/health` → `{"status":"ok","service":"phynd-crm","version":"0.1.0"}`.
- `https://crm.madfam.io/` → 307 → `/login` → 200 with **MADFAM CRM** branding
  and the Janua SSO sign-in form; `/api/health` ok; `/api/auth/csrf` 200;
  `/api/auth/session` returns `null` unauthenticated (correct).
- **Pod-host leak (audit C11) is FIXED in prod:** `/api/auth/providers` on
  `crm.madfam.io` returns only public origins
  (`signinUrl`/`callbackUrl` on `https://crm.madfam.io/...`). `phynd.app`'s
  providers endpoint 307s to `crm.phynd.app` per the domain-routing policy and
  the final JSON is also public-only.
- **OIDC first leg verified end-to-end (audit item 0.3):**
  `POST /api/auth/signin/janua` with a CSRF token → 302 to
  `auth.madfam.io/api/v1/oauth/authorize` with `response_type=code`,
  `scope=openid profile email`, PKCE `S256`, the registered `jnc_…` client id,
  and `redirect_uri=https://crm.madfam.io/api/auth/callback/janua`. Janua
  **accepted** the client + redirect URI (no error param) and 302'd to its
  login page (`/api/v1/auth/login`). The only leg not verifiable without
  credentials is the post-login token exchange (the historical
  `CallbackRouteError`) — needs one human SSO login to confirm.
- Janua discovery healthy: issuer exactly `https://auth.madfam.io`, RS256-only
  id_token signing, `S256` PKCE advertised, JWKS 200 — matches phynd's
  `AUTH_JANUA_ISSUER`, so the audit's C2 concern is confirmed **masked in
  prod** (env is correct at runtime; the manifest fix aligns file truth).
- Security headers on `crm.madfam.io`: HSTS (2y, preload, includeSubDomains),
  `x-frame-options: DENY`, `nosniff`, and a CSP-Report-Only whose
  `frame-ancestors` includes `selva.town` per WS 5.6.
- Tenant branding works: `crm.phynd.app/login` renders generic **Phynd**;
  `crm.madfam.io/login` renders **MADFAM CRM**.

### Gaps found ⚠️

- **Domain drift (audit C12, confirmed live):** `app.phynd.app`,
  `admin.phynd.app`, `api.phynd.app` were declared in `.enclii.yml` but are
  **NXDOMAIN** — never provisioned, and they contradict the README's
  production-domain policy. Removed from the manifest this session.
  Conversely `crm.phynd.app` **is live** (DNS + TLS + serving) but was
  undeclared — added to the manifest.
- Marketing copy still shows "MIT Licensed" live — expected until the C16 fix
  in PR #51 merges and deploys.

## Related

- Audit: `internal-devops/audits/2026-07-09-phyndcrm-platform-audit.md`
- Remediation plan: `internal-devops/roadmaps/2026-07-09-phyndcrm-remediation-execution-plan.md`
- Roadmap: [`ROADMAP.md`](./ROADMAP.md)

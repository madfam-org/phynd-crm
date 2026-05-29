# Phynd CRM codebase and production evidence

Date: 2026-05-27

This note records the observations used to refresh repository documentation. It
is intentionally evidence-focused: claims below are tied to local files,
commands, or read-only production checks.

## Codebase observations

- Current local commit: `f8b7bfa`.
- Repository inventory: `rg --files | wc -l` returned 680 tracked files.
- Documentation inventory: `find docs -type f | wc -l` returned 26 files.
- Workspace inventory: `pnpm-workspace.yaml` includes `apps/*`, `packages/*`,
  and `tooling/*`; package manifests exist for `apps/web`, `apps/worker`, and
  eight packages under `packages/`.
- Web runtime: `apps/web/package.json` declares Next.js 15.2, React 19,
  Tailwind 4, tRPC v11 RC packages, GraphQL Yoga, BullMQ, Drizzle, Redis,
  Auth.js v5 beta, Recharts, and Sentry/OpenTelemetry-related runtime packages.
- Worker runtime: `apps/worker/src/index.ts` starts 12 BullMQ workers:
  `federation-sync`, `cache-warmup`, `health-check`, `session-identify`,
  `lead-scoring`, `task-reminders`, `grant-compliance-check`, `email-drip`,
  `referral-reward-dispatch`, `production-dispatch`, `reddit-bot`, and
  `demo-cleanup`.
- Web routes: `find apps/web/src/app -type f -name 'page.tsx' | wc -l`
  returned 31 pages, and `find apps/web/src/app -type f -name 'route.ts' |
  wc -l` returned 34 route handlers.
- API routers: `packages/api/src/router.ts` exposes 25 tRPC routers, including
  `engagements` and `referrals`.
- GraphQL is implemented, not only planned: `apps/web/src/app/api/graphql/route.ts`
  mounts GraphQL Yoga with `packages/api/src/graphql/schema.ts`.
- Database schema: `packages/db/src/schema/` contains 26 schema/helper modules;
  `packages/db/src/schema/index.ts` exports the domain schemas including
  `engagements`, `grants`, and `referrals`. Migrations currently run from
  `0000_sad_ravenous.sql` through `0007_oval_spitfire.sql`.
- Federation providers: six provider contract tests exist under
  `packages/federation/src/providers/*/__tests__/contract.test.ts` for Janua,
  Janua Telemetry, Dhanam, Cotiza, Pravara, and Forj.
- Tests: `find apps packages scripts tests -type f \( -name '*.test.ts' -o
  -name '*.test.tsx' -o -name '*.test.mjs' -o -name '*.spec.ts' -o -name
  'test_*.py' \) | wc -l` returned 109 test files.
- Feature flags: `packages/config/src/features.ts` defines 14 flags. Enabled
  by default: `bidirectionalSync`, `leadScoring`, `multiTenancy`,
  `forjEnabled`, `visitorTracking`, `funnelManagement`, `analytics`, and
  `referralManagement`. Disabled by default: `federationReadOnly`,
  `aiKanban`, `piiMasking`, `observability`, `realtimeUpdates`, and
  `treasuryHunter`.
- Tenant resolution: `packages/services/src/context.ts` accepts an explicit
  tenant, then `auth.tenantId`, then `DEFAULT_TENANT_ID`; the default still
  falls back to `madfam`.
- Health endpoint contract: `apps/web/src/app/api/health/route.ts` returns
  `{"status":"ok","service":"phynd-crm","version":"0.1.0"}`.

## Production observations

Read-only production checks were run against public hosts and Enclii on
2026-05-27 around 02:14-02:16 UTC.

- `curl -I https://phynd.app/` returned HTTP 200 through Cloudflare with
  Next.js headers and security headers.
- `curl https://phynd.app/api/health` returned
  `{"status":"ok","service":"phynd-crm","version":"0.1.0"}`.
- `curl -I https://www.phynd.app/` returned HTTP 200.
- `curl -I https://phynd.app/demo` returned HTTP 307 to
  `https://phynd.app/overview` and set an HTTP-only `phynd-demo` cookie.
- Following `/demo` with a cookie returned HTTP 200 for
  `https://phynd.app/overview`; the rendered HTML contained the dashboard,
  sample demo metrics, and recent activities.
- `curl -I https://crm.madfam.io/` returned HTTP 307 to
  `https://crm.madfam.io/login`.
- `curl https://crm.madfam.io/login` returned HTTP 200 and contained
  `MADFAM CRM` plus `Sign in with your MADFAM Janua SSO account`.
- `curl -I https://crm.phynd.app/` returned HTTP 307 to
  `https://crm.phynd.app/login`.
- `curl https://crm.phynd.app/login` returned HTTP 200 and contained generic
  `Phynd` plus `Sign in with Janua SSO`.
- `enclii projects list` includes project `phynd-crm`.
- `enclii releases phynd-crm-web --project phynd-crm --limit 5` resolved
  service `55d2ba51-d6b3-481c-ae56-e5410c3b5a6d` and showed five recent ready
  releases; summary was 115 ready, 2 failed, 0 building.
- `enclii releases phynd-crm-worker --project phynd-crm --limit 5` resolved
  service `5e1a20e4-2302-4aa0-a37e-fa7dc9fa87ea` and showed five recent ready
  releases; summary was 115 ready, 0 failed, 0 building.
- `enclii deployments latest` for web and worker both reported running
  deployments created on 2026-05-26T23:27:50Z. Web image:
  `ghcr.io/madfam-org/phynd-crm/web@sha256:96eeb3a4a80004c6f84ae6f16f76570c3e9b2e9e71322ffca98d28cd095d4860`.
  Worker image:
  `ghcr.io/madfam-org/phynd-crm/worker@sha256:b3249871cc4d4cac65e4d11173b709e4c0dd660efd0d3d98836fb01d63aeb7e6`.
- `enclii observe health --service ... --json` reported one ready pod and
  status `healthy` for both web and worker.
- `enclii junctions list --project phynd-crm --json` listed project junctions
  for `phynd.app`, `www.phynd.app`, `crm.madfam.io`, and `app.phyne.app`.

## Remaining production gaps

- Auth.js provider metadata still leaks an internal pod host:
  `curl https://phynd.app/api/auth/providers` returned Janua `signinUrl` and
  `callbackUrl` values on `https://phynd-crm-web-...:3000/...` instead of a
  public Phynd host. Local remediation now wraps the Auth.js route handler with
  public-origin request normalization in
  `apps/web/src/app/api/auth/[...nextauth]/route.ts` and
  `apps/web/src/lib/auth/request.ts`; production remains open until that change
  is deployed and `https://phynd.app/api/auth/providers` returns public
  `phynd.app` URLs.
- Direct `GET /api/auth/signin/janua?callbackUrl=https://phynd.app/overview`
  returned HTTP 400. The login page uses a server action, so this direct check
  is not the full user-login flow, but it keeps the earlier Auth.js-origin
  concern open.
- Enclii production logs also showed Auth.js `CallbackRouteError` entries for
  Janua token exchange. After public-origin verification, the next likely
  blocker is Janua OIDC client configuration: registered redirect URI, client
  credentials, and token endpoint auth method must match Phynd production.
- Enclii junctions do not currently match all declared `.enclii.yml` domains:
  project junctions list `app.phyne.app` but not `crm.phynd.app`, `app.phynd.app`,
  `admin.phynd.app`, or `api.phynd.app`. Public `crm.phynd.app` does respond,
  so its routing is present somewhere, but not in the observed project junction
  list.
- `enclii domains list --file .enclii.yml --service phynd-crm-web --env
  production` returned "No custom domains found" even though project junctions
  exist. Treat Enclii `junctions` as the observed routing source until the
  service-domain registry is reconciled.

## Documentation update rule

Historical runbooks from 2026-05-14 and 2026-05-15 preserve the remediation
trail. When they conflict with this evidence note, use this note as the newer
production status and leave the older sections as history.

## Roadmap (2026-05-28)

Gap assessment and phased remediation are documented in:

- [`ROADMAP.md`](./ROADMAP.md) — canonical phase map and scorecard
- [`MADFAM_TRUTH_LAYER_REMEDIATION.md`](./MADFAM_TRUTH_LAYER_REMEDIATION.md) — workstreams WS0–WS9, acceptance tests, pilot milestones

Composite distance from the MADFAM tenant north star (~100% truthful ecosystem
data for sales human + Selva pilot): **~25–35%** as of this evidence date.

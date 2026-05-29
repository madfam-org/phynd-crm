# Phynd CRM — Production Deployment Guide

## Current production evidence

Latest read-only verification is recorded in
[`CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md`](CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md).
As of that check, `https://phynd.app`, `https://www.phynd.app`,
`https://phynd.app/api/health`, `https://phynd.app/demo`, `https://crm.madfam.io`,
and `https://crm.phynd.app` all respond through the public edge. Enclii reports
healthy web and worker services for project `phynd-crm`.

The remaining production gaps are Auth.js/provider-origin related and routing
registry consistency related: `/api/auth/providers` still exposes an internal
pod hostname, direct Janua signin probing returns HTTP 400, and Enclii
`junctions`/`domains` output does not fully agree.

## Prerequisites

- Docker 24+ with Compose v2
- PostgreSQL 16+ (or use Docker Compose)
- Redis 7+ (or use Docker Compose)
- Node.js 22+ and pnpm 9+ (for migrations and builds)

## Environment Variables

Core required environment variables are defined and validated in
`packages/config/src/env.ts` using Zod schemas. Additional worker, webhook,
email, and campaign variables are read directly by their owning modules and are
listed in `.env.example`. Key variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://phynd:secret@db:5432/phynd_crm` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `AUTH_SECRET` | Auth.js session secret (min 16 chars) | `your-production-secret` |
| `AUTH_JANUA_ISSUER` | Janua OIDC issuer URL | `https://janua.example.com` |
| `AUTH_JANUA_CLIENT_ID` | Janua OIDC client ID | `phynd-crm` |
| `AUTH_JANUA_CLIENT_SECRET` | Janua OIDC client secret | `secret` |
| `AUTH_TRUST_HOST` | Auth.js trusted-host behavior behind Cloudflare/Enclii | `true` |
| `NEXT_PUBLIC_APP_URL` | Public-facing app URL | `https://crm.example.com` |
| `JANUA_API_URL` | Janua Identity API | `https://api.janua.example.com` |
| `JANUA_TELEMETRY_API_URL` | Janua Telemetry API | `https://telemetry.janua.example.com` |
| `DHANAM_API_URL` | Dhanam Billing API | `https://api.dhanam.example.com` |
| `COTIZA_API_URL` | Cotiza Studio API | `https://api.cotiza.example.com` |
| `PRAVARA_BASE_URL` | PravaraMES API | `https://api.pravara.example.com` |
| `PRAVARA_API_KEY` | PravaraMES API key | `key` |
| `SELVA_API_URL` | Selva project dispatch API | `https://api.selva.example.com` |
| `SELVA_API_KEY` | Selva API key | `key` |
| `FORJ_API_URL` | Forj Assets API | `https://api.forj.example.com` |
| `OPENAI_API_KEY` | LLM API key (AutoSwarm or OpenAI) | `sk-...` or AutoSwarm worker token |
| `OPENAI_BASE_URL` | LLM endpoint override (AutoSwarm Nexus) | `http://nexus-api.autoswarm.svc.cluster.local/v1` |
| `RESEND_API_KEY` | Resend email API key | `re_...` |
| `PORTAL_BASE_URL` | Janua magic-link portal redirect base | `https://phynd.app` |
| `PHYND_ENGAGEMENT_EVENTS_SECRET` | HMAC secret for engagement event/artifact API routes | `secret` |
| `PHYND_CAMPAIGN_IMPORT_SECRET` | HMAC secret for Tulana/Selva campaign APIs (`/api/v1/campaigns/import`, `/send`, `/buyer-signals`) | `secret` |
| `SELVA_WEBHOOK_SECRET` | HMAC secret for `POST /api/webhooks/selva` (dedicated per env) | `secret` |
| `PHYND_CRM_EVENTS_SECRET` | Shared HMAC secret for ecosystem CRM events | `secret` |
| `FEDERATION_API_TOKEN` | Optional service-to-service token for internal tRPC reads | `secret` |
| `WORKER_HEALTH_PORT` | Worker health server port | `3001` |
| `SENTRY_DSN` | Optional worker Sentry DSN | `https://...` |
| `*_WEBHOOK_SECRET` | HMAC secrets for each provider | Unique per provider |

**Safety**: `AUTH_BYPASS=true` is blocked in production by Zod validation. The seed script refuses to run when `NODE_ENV=production`.

Do not set `AUTH_URL` or `NEXTAUTH_URL` to an internal pod hostname in
production. The 2026-05-27 evidence note shows Auth.js provider metadata still
leaking an internal pod host in the currently deployed build. Source now
normalizes Auth.js route requests to a trusted public origin before handing them
to Auth.js; keep this as an open production gap until the fix is deployed and
the public signin/callback URLs are verified.

### Tenant resolution (2026-05-28)

- `crm.madfam.io` resolves to tenant `madfam`; `crm.phynd.app` / `phynd.app` resolve to `phynd`.
- `getDb(tenantId)` uses `DATABASE_URL` for `madfam` and `DATABASE_URL_<TENANT>` when set (e.g. `DATABASE_URL_PHYND`).
- Until commercial DB split, both hosts may share `DATABASE_URL`; host-derived `tenantId` still scopes Redis cache keys.

## Deployment paths

Routine production movement is Enclii-first and GitOps-backed:

- `deploy-web.yml` and `deploy-worker.yml` build, sign, push, and write staging
  image digests.
- `promote-to-prod.yml` promotes staging digests to
  `infra/k8s/production/kustomization.yaml` after soak and smoke checks.
- Enclii `releases`, `deployments`, `observe`, and `junctions` are the preferred
  read surfaces for production status.

Docker Compose remains useful for standalone/local production-shape validation;
it is not the routine production path for `phynd.app`.

## Docker Build

### Using Docker Compose (standalone validation)

```bash
# Production deployment
docker compose -f docker/docker-compose.prod.yml up -d

# View logs
docker compose -f docker/docker-compose.prod.yml logs -f web
```

The production compose file starts:
- `web` — Next.js standalone app (port 3000)
- `worker` — BullMQ background job processor
- `postgres` — PostgreSQL 16 with health checks
- `redis` — Redis 7 with health checks

### Manual Docker Build

```bash
# Web app
docker build -f docker/Dockerfile.web -t phynd-web .

# Worker
docker build -f docker/Dockerfile.worker -t phynd-worker .
```

The `.dockerignore` excludes `.git`, `node_modules`, test files, coverage, and environment files from the build context.

## GitHub Deploy Workflows

`deploy-web.yml` and `deploy-worker.yml` build container images, push them to
GHCR, and commit the resulting image digest to
`infra/k8s/overlays/staging/kustomization.yaml`.

These workflows intentionally split tokens:

- Use the workflow-scoped `GITHUB_TOKEN` for checkout and same-repo staging
  digest commits.
- Use `secrets.MADFAM_BOT_PAT` for GHCR login because the existing org packages
  require package-scoped push access.

The jobs require:

- `permissions.contents: write`
- `permissions.packages: write`

Do not use the bot PAT for checkout/digest commits unless it is known to have
same-repo contents write. A package-capable PAT can publish the image and still
fail at the digest commit step if it lacks repo contents access.

Production image movement remains manual through `promote-to-prod.yml`.

## CI Build Notes

### CI status gate model

`CI` is now the canonical merge gate.

- `CI / PP5 Guardrails` (must pass first)
- `CI / NetworkPolicy port consistency`
- `CI / Lint & Typecheck`
- `CI / Unit Tests`
- `CI / Build`
- `CI / E2E Tests`

Branch protection should require the `CI` workflow (and the checks above) so merge
cannot bypass E2E. Keep `CI / E2E Tests` explicitly visible in your policy during rollout.

Reference branch protection commands (repo-admin only):

```bash
pnpm pp5:branch-protection-check
pnpm pp5:branch-protection-apply -- --repo madfam-org/phynd-crm --branch main
```

This repo also provides `node scripts/verify-ci-gates.mjs` (`pnpm ci:verify-gates`) for local/CI verification that the CI wiring remains intact.

Turbo runs in strict env mode. Runtime variables that CI, E2E, build, and
deploy tasks need are listed in `turbo.json` under `globalPassThroughEnv`.
Add new runtime-only env vars there when a task needs to read them without
making them cache hash inputs.

For a local production build, use a valid 16+ character `AUTH_SECRET` and force
`AUTH_BYPASS=false` if `.env.local` enables development auth bypass:

```bash
AUTH_BYPASS=false \
AUTH_SECRET=test-secret-123456 \
DATABASE_URL=postgresql://phynd:phynd@localhost:5432/phynd_crm \
REDIS_URL=redis://localhost:6379 \
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
pnpm build
```

The E2E workflow installs Chromium through the web workspace because
`@playwright/test` is package-local:

```bash
pnpm --filter @phynd/web exec playwright install --with-deps chromium
```

It then runs the package-local Playwright script directly:

```bash
pnpm --filter @phynd/web test:e2e
```

Do not use the root `pnpm test:e2e` in CI while setting `AUTH_BYPASS=true`;
Turbo's root task depends on a production `next build`, and production config
correctly rejects auth bypass.

Playwright CI runs the app with development auth bypass enabled. Redirect-only
browser assertions must call `test.skip(process.env.AUTH_BYPASS === 'true', ...)`
or run in a separate no-bypass job. Dashboard E2E assertions should target
accessible labels or visible text, not generated component class names.

The web app lists `pino` as an app dependency because Next externalizes it for
standalone/server bundles through `serverExternalPackages`.

## Database Migrations

```bash
# Generate migrations from schema changes
pnpm db:generate

# Apply migrations
pnpm db:migrate

# Seed (development only — blocked in production)
pnpm db:seed
```

Migrations are stored in `packages/db/src/migrations/` and tracked by Drizzle Kit.

## Health Endpoint

`GET /api/health` returns
`{ status: 'ok', service: 'phynd-crm', version: '0.1.0' }` for Docker,
Kubernetes, and edge health checks.

## Security

### Headers
All responses include security headers configured in `apps/web/next.config.ts`:
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `Strict-Transport-Security` — enforces HTTPS with preload
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-DNS-Prefetch-Control: on`
- `Permissions-Policy` — disables camera, microphone, geolocation

### Rate Limiting
- **tRPC API**: 200 requests/minute per IP via Redis sliding window
- **Webhooks**: 100 requests/minute per IP via Redis sliding window
- Both fail closed if Redis is unavailable (defense-in-depth, not sole control)
- See ADR-005 for design rationale

### Webhook Security
Provider webhook routes use HMAC verification and rate limiting. The original
six federation routes share the common handler; newer ecosystem receivers such
as Avala, CEQ, Coforma, Karafiel, RouteCraft, and engagement APIs use route-
specific handlers with the same fail-closed posture:
- Rate limiting (Redis sliding window)
- HMAC-SHA256 signature verification
- Timestamp validation (replay attack prevention)

## Monitoring

### Federation Health
The worker runs periodic health checks against all 6 providers. Results are persisted to the `health_snapshots` table and exposed via the `federation-health` tRPC router.

### Structured Logging
All services use `@phynd/logging` (pino) for structured JSON logging. Workers and webhook handlers log with contextual metadata.

## Architecture Notes

- **Tenant resolution**: Services accept an explicit tenant ID, then `auth.tenantId`, then `DEFAULT_TENANT_ID`; the default is `madfam`.
- **Federation and write paths**: Federation still avoids ETL, but the repo now includes write-side integrations for engagement events/artifacts, quote acceptance, payment reconciliation, production dispatch intent, referral rewards, and selected webhooks.
- **Feature flags**: 14 flags control feature availability. Enabled by default: `bidirectionalSync`, `leadScoring`, `multiTenancy`, `forjEnabled`, `visitorTracking`, `funnelManagement`, `analytics`, and `referralManagement`.
- **Circuit breakers**: Shared instances protect against cascade failures from provider downtime

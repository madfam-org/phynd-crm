# Phynd CRM — Production Deployment Guide

## Prerequisites

- Docker 24+ with Compose v2
- PostgreSQL 16+ (or use Docker Compose)
- Redis 7+ (or use Docker Compose)
- Node.js 22+ and pnpm 9+ (for migrations and builds)

## Environment Variables

All required environment variables are defined and validated in `packages/config/src/env.ts` using Zod schemas. Key variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://phynd:secret@db:5432/phynd_crm` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `AUTH_SECRET` | Auth.js session secret (min 16 chars) | `your-production-secret` |
| `AUTH_JANUA_ISSUER` | Janua OIDC issuer URL | `https://janua.example.com` |
| `AUTH_JANUA_CLIENT_ID` | Janua OIDC client ID | `phynd-crm` |
| `AUTH_JANUA_CLIENT_SECRET` | Janua OIDC client secret | `secret` |
| `NEXT_PUBLIC_APP_URL` | Public-facing app URL | `https://crm.example.com` |
| `JANUA_API_URL` | Janua Identity API | `https://api.janua.example.com` |
| `JANUA_TELEMETRY_API_URL` | Janua Telemetry API | `https://telemetry.janua.example.com` |
| `DHANAM_API_URL` | Dhanam Billing API | `https://api.dhanam.example.com` |
| `COTIZA_API_URL` | Cotiza Studio API | `https://api.cotiza.example.com` |
| `PRAVARA_BASE_URL` | PravaraMES API | `https://api.pravara.example.com` |
| `PRAVARA_API_KEY` | PravaraMES API key | `key` |
| `FORJ_API_URL` | Forj Assets API | `https://api.forj.example.com` |
| `OPENAI_API_KEY` | LLM API key (AutoSwarm or OpenAI) | `sk-...` or AutoSwarm worker token |
| `OPENAI_BASE_URL` | LLM endpoint override (AutoSwarm Nexus) | `http://nexus-api.autoswarm.svc.cluster.local/v1` |
| `RESEND_API_KEY` | Resend email API key | `re_...` |
| `*_WEBHOOK_SECRET` | HMAC secrets for each provider | Unique per provider |

**Safety**: `AUTH_BYPASS=true` is blocked in production by Zod validation. The seed script refuses to run when `NODE_ENV=production`.

## Docker Build

### Using Docker Compose (recommended)

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

Reference branch protection command (repo-admin only):

```bash
gh api repos/madfam-org/phynd-crm/branches/main/protection --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["CI / PP5 Guardrails","CI / NetworkPolicy port consistency","CI / Lint & Typecheck","CI / Unit Tests","CI / Build","CI / E2E Tests"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1}' \
  --field allow_force_pushes=false \
  --field allow_deletions=false
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

`GET /api/health` returns `{ status: 'ok', timestamp: '...' }` for Docker health checks and load balancer probes.

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
All 6 provider webhook routes use a shared handler with:
- Rate limiting (Redis sliding window)
- HMAC-SHA256 signature verification
- Timestamp validation (replay attack prevention)

## Monitoring

### Federation Health
The worker runs periodic health checks against all 6 providers. Results are persisted to the `health_snapshots` table and exposed via the `federation-health` tRPC router.

### Structured Logging
All services use `@phynd/logging` (pino) for structured JSON logging. Workers and webhook handlers log with contextual metadata.

## Architecture Notes

- **Single-tenant**: Phase 1 uses hardcoded `tenantId: 'madfam'` in all service contexts
- **Read-only federation**: Data is fetched and cached from external systems, not written back
- **Feature flags**: 12 flags control feature availability; 6 are enabled for Phase 1 (see `packages/config/src/features.ts`)
- **Circuit breakers**: Shared instances protect against cascade failures from provider downtime

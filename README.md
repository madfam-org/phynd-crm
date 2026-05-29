# Phynd CRM

A phygital CRM platform -- "Synthetic Single Pane of Glass" -- that federates real-time data from six MADFAM ecosystem platforms without duplicating it. Open-source core with a commercial SaaS tier.

Current codebase and production observations are tracked in
[`docs/CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md`](docs/CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md).

**Roadmap and remediation:** canonical sequencing lives in
[`docs/ROADMAP.md`](docs/ROADMAP.md) and the executable plan in
[`docs/MADFAM_TRUTH_LAYER_REMEDIATION.md`](docs/MADFAM_TRUTH_LAYER_REMEDIATION.md).

## Overview

Phynd owns CRM-native entities (contacts, leads, opportunities, pipelines) and virtualizes identity, billing, custom orders, fabrication status, and 3D asset data from external systems. Rather than copying data through ETL pipelines, Phynd queries each upstream platform on demand through a federation layer that handles caching, circuit breaking, retry logic, and partial failure tolerance.

## Architecture

```
                         +------------------+
                         |   apps/web       |
                         |  (Next.js 15)    |
                         +--------+---------+
                                  |
                          tRPC / API Routes
                                  |
                     +------------+------------+
                     |  packages/services      |
                     |  (business logic)       |
                     +------------+------------+
                                  |
              +-------------------+-------------------+
              |                                       |
   +----------+----------+             +--------------+--------------+
   |   packages/db       |             |   packages/federation       |
   |   (Drizzle + PG)    |             |   (data virtualization)     |
   +---------------------+             +--+-----+------+-------+--+-+
                                          |     |      |       |  |
                                       Janua  Janua   Dhanam Cotiza Pravara Forj
                                              Telemetry
```

All federation calls use `Promise.allSettled()` so that a failure in one provider does not block the rest of the page. The service layer is transport-agnostic: tRPC is the main application transport, and a GraphQL Yoga endpoint is present at `/api/graphql` for the current health/client-profile schema surface.

## Tech Stack

| Layer          | Technology                                     |
| -------------- | ---------------------------------------------- |
| Monorepo       | Turborepo + pnpm workspaces                    |
| Frontend       | Next.js 15 (App Router), React 19, Tailwind 4  |
| UI Components  | shadcn/ui                                       |
| API            | tRPC v11, GraphQL Yoga endpoint                |
| ORM            | Drizzle ORM                                     |
| Database       | PostgreSQL 16                                   |
| Cache / Queue  | Redis 7 (ioredis) + BullMQ                     |
| Auth           | Auth.js v5 with Janua as OIDC provider          |
| Lint / Format  | Biome                                           |
| Testing        | Vitest (unit), Playwright (E2E)                 |
| Language       | TypeScript 5.7                                  |

## Project Structure

```
phynd-crm/
  apps/
    web/              Next.js frontend and API routes
    worker/           BullMQ background job processors
  packages/
    api/              tRPC routers
    config/           Zod env validation and feature flags
    db/               Drizzle schema and migrations
    federation/       Data virtualization layer (providers, cache, retry, circuit breaker)
    logging/          Structured logging (pino)
    services/         Transport-agnostic business logic
    types/            Shared TypeScript types
    ui/               Shared UI primitives
  tooling/            Shared tsconfig and Biome config
  docker/             Docker Compose for local Postgres and Redis
```

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm >= 9
- Docker (for PostgreSQL and Redis)

### Setup

```bash
git clone https://github.com/madfam-org/phynd-crm.git
cd phynd-crm
pnpm install

# Start infrastructure
docker compose -f docker/docker-compose.yml up -d

# Configure environment
cp .env.example .env
# Edit .env with your Janua OIDC credentials and any other values

# Database setup
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# Start development
pnpm dev
```

The app will be available at `http://localhost:3000`.

### Development Commands

| Command            | Description                                 |
| ------------------ | ------------------------------------------- |
| `pnpm dev`         | Start all apps in development mode          |
| `pnpm build`       | Build all packages                          |
| `pnpm typecheck`   | Run TypeScript checks across the monorepo   |
| `pnpm lint`        | Run Biome linter                            |
| `pnpm format`      | Run Biome formatter                         |
| `pnpm test`        | Run Vitest unit tests                       |
| `pnpm test:e2e`    | Run Playwright end-to-end tests             |
| `pnpm db:generate` | Generate Drizzle migrations                 |
| `pnpm db:migrate`  | Apply database migrations                   |
| `pnpm db:seed`     | Seed the database with sample data          |
| `pnpm db:studio`   | Open Drizzle Studio for database inspection |
| `pnpm clean`       | Remove build artifacts                      |
| `pnpm verify:prod-auth` | Verify production OIDC sign-in URLs have no pod-name leaks |
| `pnpm verify:migrations` | Verify migration artifacts `0008`/`0009` exist |
| `pnpm verify:pilot-readiness` | Bundle: prod auth + migrations + PP5 webhook lanes |

## Federation Layer

Phynd uses a data virtualization pattern rather than ETL. Each external platform is represented by a class that implements the `FederationProvider` interface, exposing a uniform API for querying upstream data.

### Cache Strategy

- Redis-backed with tenant-namespaced keys: `phynd:{tenantId}:fed:{provider}:{id}`
- Per-provider TTLs tuned to each platform's data volatility
- Webhook-driven cache invalidation for real-time consistency

### Circuit Breaker

The federation layer wraps each provider with a circuit breaker to prevent cascading failures:

| State     | Behavior                                                  |
| --------- | --------------------------------------------------------- |
| CLOSED    | Normal operation; requests pass through to the provider   |
| OPEN      | Triggered after 5 failures in 60 seconds; all calls fail fast |
| HALF_OPEN | After 30 seconds, allows probe requests through           |
| CLOSED    | Restored after 3 consecutive successes in HALF_OPEN state |

### Retry Policy

Failed requests are retried with exponential backoff and jitter to avoid thundering-herd effects.

### Partial Failure Tolerance

All SPOG (Single Pane of Glass) queries use `Promise.allSettled()`. If one provider is down or slow, the remaining providers still return data and the UI renders a partial view with a degradation indicator.

## External Systems

Phynd federates data from six active platforms in the MADFAM ecosystem:

| Platform             | Role                          | Status              | Integration              |
| -------------------- | ----------------------------- | ------------------- | ------------------------ |
| **Janua**            | Identity and access (OIDC)    | Active              | OIDC provider, REST API, webhook cache invalidation |
| **Janua Telemetry**  | Visitor sessions / page views | Active              | REST API (TTL=60s), UTM tracking |
| **Dhanam**           | Billing and monetization      | Active              | REST SDK with idempotency keys |
| **Cotiza Studio**    | Custom orders / quotes        | Active              | REST + WebSocket for real-time updates |
| **PravaraMES**       | Fabrication order status      | Active              | REST (+ WebSocket future) |
| **Forj**             | 3D digital assets / storefront | Active              | REST API, 3D asset interactions |

## Current Implementation Status

The original PRD is still useful as strategy, but the codebase has moved beyond
the first MVP slice. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for phased targets
and [`docs/MADFAM_TRUTH_LAYER_REMEDIATION.md`](docs/MADFAM_TRUTH_LAYER_REMEDIATION.md)
for the full gap-closure plan (MADFAM tenant truth layer, SKU loop, Selva
copilot).

**Snapshot (2026-05-28):** ~25–35% of the north-star goal — strong CRM +
federation seam, not yet ecosystem-complete truthful data for all SKUs,
visitors, and agent sales.

Evidence from `packages/config/src/features.ts`, `packages/api/src/router.ts`,
and the route inventory:

- 25 tRPC routers are exposed, including engagements and referrals.
- `/api/graphql` is implemented with GraphQL Yoga.
- Six federation providers are present and covered by contract tests: Janua,
  Janua Telemetry, Dhanam, Cotiza, Pravara, and Forj.
- Feature flags now total 14. Enabled by default: `bidirectionalSync`,
  `leadScoring`, `multiTenancy`, `forjEnabled`, `visitorTracking`,
  `funnelManagement`, `analytics`, and `referralManagement`.
- Tenant resolution accepts an explicit tenant ID, then `auth.tenantId`, then
  `DEFAULT_TENANT_ID`, which defaults to `madfam`. Host-derived tenant wiring
  for `crm.madfam.io` is planned in Phase 1 of the roadmap.

## Testing

Run unit tests across the monorepo:

```bash
pnpm test
```

Run Playwright end-to-end tests (requires the dev server and infrastructure to be running):

```bash
pnpm test:e2e
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values. The key groups are:

| Group                  | Variables                                            |
| ---------------------- | ---------------------------------------------------- |
| Database               | `DATABASE_URL`                                       |
| Redis                  | `REDIS_URL`                                          |
| Auth (Janua OIDC)      | `AUTH_SECRET`, `AUTH_JANUA_ISSUER`, `AUTH_JANUA_CLIENT_ID`, `AUTH_JANUA_CLIENT_SECRET`, `AUTH_BYPASS`, `AUTH_TRUST_HOST` |
| App / tenant           | `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`, `PORTAL_BASE_URL`, `NODE_ENV`, `DEFAULT_TENANT_ID` |
| Federation URLs        | `JANUA_API_URL`, `JANUA_TELEMETRY_API_URL`, `DHANAM_API_URL`, `COTIZA_API_URL`, `PRAVARA_BASE_URL`, `SELVA_API_URL`, `FORJ_API_URL` |
| Federation API Keys    | `PRAVARA_API_KEY`, `SELVA_API_KEY`, `FEDERATION_API_TOKEN` |
| Production dispatch    | `PRAVARA_DISPATCH_URL`, `SELVA_DISPATCH_URL`, `PRAVARA_DISPATCH_SECRET`, `SELVA_DISPATCH_SECRET`, `PRODUCTION_DISPATCH_SCAN_LIMIT`, `PRODUCTION_DISPATCH_TIMEOUT_MS` |
| Webhook secrets        | `JANUA_WEBHOOK_SECRET`, `JANUA_TELEMETRY_WEBHOOK_SECRET`, `DHANAM_WEBHOOK_SECRET`, `COTIZA_WEBHOOK_SECRET`, `PRAVARA_WEBHOOK_SECRET`, `FORJ_WEBHOOK_SECRET`, `TEZCA_WEBHOOK_SECRET`, `FORTUNA_WEBHOOK_SECRET`, `CEQ_WEBHOOK_SECRET`, `COFORMA_WEBHOOK_SECRET`, `PHYND_CRM_EVENTS_SECRET`, `PHYND_ENGAGEMENT_EVENTS_SECRET` |
| Payments / engagement  | `PHYNDCRM_OUTBOUND_SECRET`, `COTIZA_WEBHOOK_TIMEOUT`, `KARAFIEL_API_URL`, `KARAFIEL_API_KEY`, `KARAFIEL_WEBHOOK_SECRET` |
| Email / campaigns      | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_ALLOWLIST_DOMAINS`, `UNSUBSCRIBE_SECRET`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `INTERNAL_TEZCA_KEY`, `TEZCA_API_URL`, `TEZCA_PUBLIC_URL`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REFRESH_TOKEN`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_USER_AGENT`, `REDDIT_TARGET_SUBREDDITS` |
| Observability          | `LOG_LEVEL`, `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `WORKER_HEALTH_PORT` |

Core runtime variables are validated with Zod in `packages/config`; additional
worker, webhook, and campaign variables are read directly by their owning
modules and listed in `.env.example`.

## Fortuna AI Pipeline Integration

Phynd CRM is the campaign orchestration layer for the autonomous legal scouting pipeline:

```
fortuna-jobs  ──► madfam-crawler  ──► fortuna-nlp
                                           │ (confidence ≥ 0.85)
                                    POST /api/campaigns/trigger
                                           │
                                     RedditBotService
                                           ├── Tezca oracle query
                                           ├── LLM draft via OpenAI-compatible endpoint
                                           └── Campaign saved as status="draft"
                                           │
                                  /campaigns/drafts  (review UI)
                                           │
                               [Approve] → postRedditComment()
                                           │
                                  u/madfam-bot posts reply ✓
```

For Tulana-driven SKU launch campaigns, use
`docs/TULANA_SKU_CAMPAIGN_INPUTS_2026-05-29.md`. That contract keeps SKU
readiness in Tulana, orchestration in Selva, and campaign/contact state in
Phynd CRM.

### Key Files

| File | Purpose |
|---|---|
| `apps/web/src/app/api/campaigns/trigger/route.ts` | Inbound webhook — receives high-confidence signals from Fortuna |
| `packages/services/src/campaigns/reddit-bot.ts` | Orchestrates Tezca query + OpenAI draft + CRM staging |
| `packages/services/src/campaigns/reddit-poster.ts` | Reddit OAuth2 client — posts approved replies as `u/madfam-bot` |
| `apps/web/src/app/(dashboard)/campaigns/drafts/page.tsx` | Human-in-the-loop review UI |
| `apps/web/src/app/api/campaigns/drafts/action/route.ts` | Approve/Reject handler that triggers Reddit posting |

### Reddit Bot Setup

See the [walkthrough artifact](https://github.com/madfam-org/phynd-crm) for the one-time Reddit OAuth refresh token setup required to activate live posting.

## License

No `LICENSE` file is currently committed. The public marketing UI advertises an
MIT-licensed core, but treat the repository license as not formally declared
until the legal license file is added.


## Avala webhook receiver

PhyndCRM receives Avala visitor, lead, user, tenant, subscription, and payment lifecycle events at `POST /api/webhooks/avala`.

The receiver:

- verifies `x-madfam-signature` with `PHYND_CRM_EVENTS_SECRET`;
- rate-limits inbound requests;
- deduplicates by Avala `event_id` in `webhook_events`;
- maps `avala.lead.captured` into contacts, leads, visitor sessions, and `visitor_to_lead` conversions;
- maps Avala search/page/conversion/user/tenant/billing events into CRM activity and conversion records.

Avala producers must send the shared event envelope documented in Avala's `docs/architecture/PHYNDCRM_AVALA_INTEGRATION.md`.

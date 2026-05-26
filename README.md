# Phynd CRM

A phygital CRM platform -- "Synthetic Single Pane of Glass" -- that federates real-time data from six MADFAM ecosystem platforms without duplicating it. Open-source core with a commercial SaaS tier.

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
                                       Janua  Janua   Dhanam Cotiza Pravara Forj*
                                              Telemetry

* Forj is feature-flagged off in MVP
```

All federation calls use `Promise.allSettled()` so that a failure in one provider does not block the rest of the page. The service layer is transport-agnostic: tRPC is the transport for the MVP, with GraphQL federation planned for Phase 2+.

## Tech Stack

| Layer          | Technology                                     |
| -------------- | ---------------------------------------------- |
| Monorepo       | Turborepo + pnpm workspaces                    |
| Frontend       | Next.js 15 (App Router), React 19, Tailwind 4  |
| UI Components  | shadcn/ui                                       |
| API            | tRPC v11 (MVP), GraphQL federation (Phase 2+)  |
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
git clone https://github.com/your-org/phynd-crm.git
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

Phynd federates data from six platforms in the MADFAM ecosystem (5 active in MVP, 1 feature-flagged):

| Platform             | Role                          | Status              | Integration              |
| -------------------- | ----------------------------- | ------------------- | ------------------------ |
| **Janua**            | Identity and access (OIDC)    | Active              | OIDC provider, REST API, webhook cache invalidation |
| **Janua Telemetry**  | Visitor sessions / page views | Active              | REST API (TTL=60s), UTM tracking |
| **Dhanam**           | Billing and monetization      | Active              | REST SDK with idempotency keys |
| **Cotiza Studio**    | Custom orders / quotes        | Active              | REST + WebSocket for real-time updates |
| **PravaraMES**       | Fabrication order status      | Active              | REST (+ WebSocket future) |
| **Forj**             | 3D digital assets / storefront | Active              | REST API, 3D asset interactions |

## Phasing

| Phase              | Scope                                                            |
| ------------------ | ---------------------------------------------------------------- |
| Phase 1 (MVP)      | Single-tenant, read-only federation, CRM-native CRUD             |
| Phase 2            | Bidirectional sync, lead scoring, AI Kanban observability         |
| Phase 3            | Multi-tenant SaaS, open-source community core                    |

The `tenantId` is present in the service context from day one (hardcoded to `'madfam'` in Phase 1) so the codebase is structurally ready for multi-tenancy in Phase 3.

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
| Auth (Janua OIDC)      | `AUTH_SECRET`, `AUTH_JANUA_ISSUER`, `AUTH_JANUA_CLIENT_ID`, `AUTH_JANUA_CLIENT_SECRET` |
| Federation URLs        | `JANUA_API_URL`, `JANUA_TELEMETRY_API_URL`, `DHANAM_API_URL`, `COTIZA_API_URL`, `PRAVARA_BASE_URL`, `FORJ_API_URL` |
| Federation API Keys    | `PRAVARA_API_KEY`                                    |
| Webhook Secrets        | `JANUA_WEBHOOK_SECRET`, `DHANAM_WEBHOOK_SECRET`, `COTIZA_WEBHOOK_SECRET`, `PRAVARA_WEBHOOK_SECRET`, `FORJ_WEBHOOK_SECRET` |
| App                    | `NEXT_PUBLIC_APP_URL`, `NODE_ENV`                    |
| AI Pipeline (Fortuna)  | `OPENAI_API_KEY`, `PHYND_WEBHOOK_SECRET`             |
| Tezca Oracle           | `INTERNAL_TEZCA_KEY`, `TEZCA_API_URL`               |
| Reddit Bot             | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REFRESH_TOKEN`, `REDDIT_BOT_USERNAME` |

All environment variables are validated at startup using Zod schemas in `packages/config`.

## Fortuna AI Pipeline Integration

Phynd CRM is the campaign orchestration layer for the autonomous legal scouting pipeline:

```
fortuna-jobs  ──► madfam-crawler  ──► fortuna-nlp
                                           │ (confidence ≥ 0.85)
                                    POST /api/campaigns/trigger
                                           │
                                     RedditBotService
                                           ├── Tezca oracle query
                                           ├── OpenAI GPT-4 draft
                                           └── Campaign saved as status="draft"
                                           │
                                  /campaigns/drafts  (review UI)
                                           │
                               [Approve] → postRedditComment()
                                           │
                                  u/madfam-bot posts reply ✓
```

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

TBD


## Avala webhook receiver

PhyndCRM receives Avala visitor, lead, user, tenant, subscription, and payment lifecycle events at `POST /api/webhooks/avala`.

The receiver:

- verifies `x-madfam-signature` with `PHYND_CRM_EVENTS_SECRET`;
- rate-limits inbound requests;
- deduplicates by Avala `event_id` in `webhook_events`;
- maps `avala.lead.captured` into contacts, leads, visitor sessions, and `visitor_to_lead` conversions;
- maps Avala search/page/conversion/user/tenant/billing events into CRM activity and conversion records.

Avala producers must send the shared event envelope documented in Avala's `docs/architecture/PHYNDCRM_AVALA_INTEGRATION.md`.

# Phyne CRM

A phygital CRM platform -- "Synthetic Single Pane of Glass" -- that federates real-time data from six MADFAM ecosystem platforms without duplicating it. Open-source core with a commercial SaaS tier.

## Overview

Phyne owns CRM-native entities (contacts, leads, opportunities, pipelines) and virtualizes identity, billing, custom orders, fabrication status, and 3D asset data from external systems. Rather than copying data through ETL pipelines, Phyne queries each upstream platform on demand through a federation layer that handles caching, circuit breaking, retry logic, and partial failure tolerance.

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
phyne-crm/
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
git clone https://github.com/your-org/phyne-crm.git
cd phyne-crm
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

Phyne uses a data virtualization pattern rather than ETL. Each external platform is represented by a class that implements the `FederationProvider` interface, exposing a uniform API for querying upstream data.

### Cache Strategy

- Redis-backed with tenant-namespaced keys: `phyne:{tenantId}:fed:{provider}:{id}`
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

Phyne federates data from six platforms in the MADFAM ecosystem (5 active in MVP, 1 feature-flagged):

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

All environment variables are validated at startup using Zod schemas in `packages/config`.

## License

TBD

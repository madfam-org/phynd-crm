# Phyne CRM - Project Instructions

## Overview
Phyne is a phygital CRM — "Synthetic Single Pane of Glass" that federates data from 6 MADFAM ecosystem platforms (Janua, Janua Telemetry, Dhanam, Cotiza, PravaraMES, Forj) without duplicating it. All 5 core providers are active; Janua Telemetry is feature-flagged via `visitorTracking`.

## Tech Stack
- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 15 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui
- **API**: tRPC v11 (MVP) — service layer is transport-agnostic for future GraphQL
- **ORM**: Drizzle ORM + PostgreSQL 16
- **Cache/Queue**: Redis (ioredis) + BullMQ
- **Auth**: Auth.js v5 with Janua as OIDC provider
- **Tooling**: Biome (lint/format), Vitest + Playwright (test)

## Project Structure
```
apps/web          — Next.js frontend + API routes
apps/worker       — BullMQ background processors
packages/api      — tRPC routers
packages/config   — Zod env validation, feature flags
packages/db       — Drizzle schema + migrations
packages/federation — Data virtualization layer (providers, cache, retry, circuit breaker)
packages/services — Transport-agnostic business logic
packages/types    — Shared TypeScript types
packages/ui       — Shared UI primitives
tooling/          — Shared tsconfig, biome config
```

## Commands
```bash
pnpm dev              # Start all apps in dev mode
pnpm build            # Build all packages
pnpm typecheck        # TypeScript checks across monorepo
pnpm lint             # Biome lint
pnpm test             # Vitest unit tests
pnpm test:e2e         # Playwright E2E tests
pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Run migrations
pnpm db:seed          # Seed database
```

## Key Patterns
- **Federation**: `Promise.allSettled()` across 6 providers (5 active + Janua Telemetry feature-flagged) — partial failures don't block
- **Cache**: Redis with tenant-namespaced keys (`phyne:{tenantId}:fed:{provider}:{id}`)
- **Circuit Breaker**: CLOSED → OPEN (5 failures/60s) → HALF_OPEN (30s) → CLOSED (3 successes)
- **tenantId**: Hardcoded to `'madfam'` in Phase 1, extracted from JWT in Phase 3
- **No .js extensions**: Relative imports use extensionless paths for bundler compatibility
- **Auto-conversion tracking**: Lead/opportunity creation and status changes auto-record conversion events
- **Lead scoring**: Configurable rules engine evaluating conditions against lead + visitor session data

## DB Schema
contacts, leads, opportunities, pipelines, pipeline_stages, activities, notes, tags, taggables, external_references, role_preferences, webhook_events, visitor_sessions, offers, campaigns, conversions, stage_transitions, health_snapshots, lead_scoring_rules, lead_scores

## tRPC Routers
contacts, leads, opportunities, pipelines, activities, unified-profile, federation-health, visitor-tracking, offers, campaigns, conversions, analytics, lead-scoring

## Feature Flags (12 total)
- `federationReadOnly: true` — Phase 1 read-only SPOG
- `forjEnabled: true` — Forj 3D digital assets provider
- `visitorTracking: false` — Anonymous visitor tracking via Janua telemetry
- `funnelManagement: false` — Funnel and offer management
- `analytics: false` — Analytics dashboard
- 7 others (bidirectionalSync, leadScoring, aiKanban, multiTenancy, piiMasking, observability, realtimeUpdates) — all `false`

## Phasing
- Phase 1 (MVP): Single-tenant, read-only federation + visitor tracking + offers + analytics + lead scoring
- Phase 2: Bidirectional sync, AI Kanban
- Phase 3: Multi-tenant SaaS

## Local Development
```bash
docker compose -f docker/docker-compose.yml up -d  # Start Postgres + Redis
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

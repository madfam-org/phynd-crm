# Phyne CRM - Project Instructions

## Overview
Phyne is a phygital CRM — "Synthetic Single Pane of Glass" that federates data from 6 MADFAM ecosystem platforms (Janua, Janua Telemetry, Dhanam, Cotiza, PravaraMES, Forj) without duplicating it. All 6 providers are active.

## Tech Stack
- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 15 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui + recharts
- **API**: tRPC v11 (MVP) — service layer is transport-agnostic for future GraphQL
- **ORM**: Drizzle ORM + PostgreSQL 16
- **Cache/Queue**: Redis (ioredis) + BullMQ
- **Auth**: Auth.js v5 with Janua as OIDC provider
- **Theming**: next-themes (dark mode via `.dark` class)
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
packages/logging  — Structured logging (pino)
packages/types    — Shared TypeScript types
packages/ui       — Shared UI primitives
tooling/          — Shared tsconfig, biome config
.github/workflows — CI/CD (ci.yml, e2e.yml)
docker/           — Dockerfile.web, Dockerfile.worker, docker-compose.yml, docker-compose.prod.yml
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
- **Federation**: `Promise.allSettled()` across 6 providers — partial failures don't block
- **Cache**: Redis with tenant-namespaced keys (`phyne:{tenantId}:fed:{provider}:{id}`)
- **Circuit Breaker**: CLOSED → OPEN (5 failures/60s) → HALF_OPEN (30s) → CLOSED (3 successes); shared CB instances between FederationClient and HealthChecker
- **Timeout**: Config-driven via `ProviderConfig.timeout` → `AbortSignal.timeout()` passed to provider `fetch()`; providers accept optional `signal` parameter
- **tenantId**: Hardcoded to `'madfam'` in Phase 1, extracted from JWT in Phase 3
- **No .js extensions**: Relative imports use extensionless paths for bundler compatibility
- **Pagination**: Cursor-based — services accept `PaginationInput { cursor?, limit? }` and return `PaginatedResult<T> { items, nextCursor, hasMore }`
- **Soft deletes**: contacts, leads, opportunities use `deletedAt` column; `list()`/`getById()` filter `isNull(deletedAt)`; `delete()` sets `deletedAt` instead of hard delete
- **Transactions**: Multi-table mutations (lead create + conversion, opportunity create/won + conversion, offer auto-redemption) are wrapped in `db.transaction()`
- **Auto-conversion tracking**: Lead/opportunity creation and status changes auto-record conversion events; conversions auto-redeem linked campaign offers
- **Lead scoring**: Configurable rules engine evaluating conditions against lead + visitor session + page view data; auto-recomputes on lead create, status change, and visitor identify; breakdown keyed by rule ID (not name)
- **Scoring conditions**: source, status, session_count, page_view_count, has_contact, page_url (contains/eq), 3d_asset_views (forj:// URL scheme)
- **Fabrication activities**: PravaraMES webhook auto-creates CRM activities on fabrication status changes
- **Routing**: `/` is the public marketing landing page (static); dashboard lives at `/overview` behind auth; middleware allows `/` unauthenticated
- **Feature flags**: `getFeatureFlags()` returns frozen copy; `setFeatureFlags()` throws in production
- **Auth safety**: `AUTH_BYPASS=true` blocked in production via Zod superRefine
- **Error handling**: Structured errors (`ServiceError`, `NotFoundError`, `ValidationError`, `FederationError`, `ConflictError`) in `packages/services/src/errors.ts`
- **Webhook security**: Rate limiting (Redis sliding window, 100 req/min/IP) + HMAC-SHA256 + timestamp validation via shared handler (`apps/web/src/lib/webhooks/handler.ts`); all 6 webhook routes use the shared handler
- **Structured logging**: `@phyne/logging` package (pino); all worker processors and webhook handler use structured JSON logging
- **Signal propagation**: All 6 federation providers accept optional `signal?: AbortSignal` parameter, with config-driven fallback timeouts
- **Owner-scoped queries**: `list()` accepts optional `filters?: { ownerId?: string }`; `listMine` router procedures auto-scope to `ctx.auth.userId`
- **Timeline**: `TimelineService.getTimeline()` merges activities, stage_transitions, and notes into chronological `TimelineEntry[]`
- **Weighted pipeline**: `AnalyticsService.getWeightedPipelineValue()` computes `sum(value * probability / 100)` for open opps
- **At-risk deals**: `AnalyticsService.getAtRiskDeals()` flags opps stuck > threshold days or > 1.5× avg stage velocity
- **Notifications**: Owner assignment triggers non-blocking notification creation in leads/opportunities `update()`

## DB Schema
users, contacts, leads, opportunities, pipelines, pipeline_stages, activities, notes, notifications, tags, taggables, external_references, role_preferences, webhook_events, visitor_sessions, visitor_page_views, offers, campaigns, conversions, stage_transitions, health_snapshots, lead_scoring_rules, lead_scores

### Indexes
- leads: `contact_id`, composite `(pipeline_id, stage_id)`
- opportunities: `contact_id`, composite `(pipeline_id, stage_id)`
- activities: composite `(entity_type, entity_id)`
- notes: composite `(entity_type, entity_id)`
- taggables: composite `(entity_type, entity_id)`
- external_references: composite `(entity_type, entity_id)`, composite `(provider, external_id)`
- visitor_sessions: `contact_id`, unique `external_session_id`
- visitor_page_views: `session_id`
- conversions: `campaign_id`, `contact_id`, `lead_id`, `visitor_session_id`, partial unique `(type, lead_id)`, partial unique `(type, opportunity_id)`
- stage_transitions: composite `(entity_type, entity_id)`, composite `(to_stage_id, from_stage_id)`
- lead_scores: unique `lead_id`
- notifications: `user_id`, composite `(user_id, is_read)`

### Soft Delete Columns
- contacts, leads, opportunities: `deleted_at` (nullable timestamp)

## tRPC Routers
contacts (+ listMine), leads (+ listMine, listByContactId, bulkUpdateStatus), opportunities (+ listMine, listByContactId, bulkUpdateStatus), pipelines, activities (list, listMine, listForEntity, create, update, delete, complete), notes (listForEntity, create, update, delete, togglePin), tags (list, create, delete, addToEntity, removeFromEntity, getForEntity), users (admin-gated: list, getById, create, update, delete), search (search), unified-profile, federation-health, visitor-tracking, offers, campaigns, conversions, analytics (+ weightedPipelineValue, atRiskDeals, with date range filtering), lead-scoring, preferences (getForRole, upsert), timeline (getTimeline), notifications (list, unreadCount, markAsRead, markAllAsRead)

## Feature Flags (12 total)
- `federationReadOnly: true` — Phase 1 read-only SPOG
- `forjEnabled: true` — Forj 3D digital assets provider
- `visitorTracking: true` — Anonymous visitor tracking via Janua telemetry
- `funnelManagement: true` — Funnel and offer management
- `analytics: true` — Analytics dashboard
- `leadScoring: true` — Configurable lead scoring with auto-recomputation
- 6 others (bidirectionalSync, aiKanban, multiTenancy, piiMasking, observability, realtimeUpdates) — all `false`

## Phasing
- Phase 1 (MVP): Single-tenant, read-only federation + visitor tracking + offers + analytics + lead scoring
- Phase 2: Bidirectional sync, AI Kanban
- Phase 3: Multi-tenant SaaS

## Frontend Features
- **Dark mode**: next-themes with `.dark` class selector (globals.css); ThemeToggle in header
- **Mobile nav**: Sheet-based sidebar (slides from left, auto-close on route change)
- **Sidebar icons**: Lucide icons via shared `navigation.ts` module
- **Loading skeletons**: `TableSkeleton`, `CardSkeleton` + Next.js `loading.tsx` files for overview/analytics
- **Error pages**: Global `error.tsx`, `not-found.tsx`, dashboard-scoped `error.tsx`/`loading.tsx`
- **Data table search/filter**: Client-side search + status filter on contacts, leads, opportunities, visitors, offers
- **Radix Select**: All dropdowns use `@radix-ui/react-select` (not native `<select>`)
- **Polling**: `refetchInterval` on data tables (60s leads/opps/activities, 120s contacts)
- **Analytics charts**: recharts (ConversionFunnelChart, PipelineVelocityChart, RevenueByStatusChart)
- **Activities CRUD**: Full create/edit/delete/complete via data table with dialogs
- **Notes panel**: Per-entity notes (contact/lead/opportunity) with create/edit/delete/pin toggle
- **Tags panel**: Per-entity tags with add/remove, badge display, create new tags with color
- **User management**: Admin-gated CRUD at `/settings/users`
- **Global search**: Cmd+K searchbar in header, searches contacts/leads/opportunities with debounced query
- **Kanban pipeline**: Drag-and-drop pipeline board using `@hello-pangea/dnd`, moves leads/opps between stages
- **Contact detail**: Federation tabs + activities + notes + tags + related leads/opportunities
- **Dashboard charts**: ConversionFunnelChart + RevenueByStatusChart on overview page, plus recent activities
- **Bulk operations**: Row selection checkboxes on data tables, bulk status change for leads/opportunities
- **CSV export**: Export contacts/leads/opportunities to CSV (all or selected rows)
- **Owner column**: Leads and opportunities tables show owner name, edit dialogs have owner select
- **Health endpoint**: `GET /api/health` returns `{ status: 'ok', timestamp }` for Docker health checks
- **Lead detail page**: `/leads/[id]` — info card + timeline + notes + tags
- **Opportunity detail page**: `/opportunities/[id]` — info card + timeline + notes + tags
- **Notification bell**: In header, polls unreadCount every 30s, click navigates to entity
- **My Deals toggle**: Segmented button on leads/opportunities tables to switch between owner-scoped and all records
- **Stage names**: Data tables resolve stageId to human-readable stage name via pipeline stages lookup
- **DB migrations**: Generated via `pnpm db:generate`, stored in `packages/db/src/migrations/`

## Worker Processors
- `health-check`: Calls `checkAll()` and persists results to `healthSnapshots` table
- `session-identify`: Wired with real DB + `VisitorTrackingService.upsertFromWebhook()`
- `lead-scoring`: Wired with real DB + `LeadScoringService.batchCompute()`
- `cache-warmup`: Pre-fetches federation data for given external IDs
- `federation-sync`: Handles cache invalidation and refresh
- All workers have `completed`/`failed`/`stalled` event handlers + `maxStalledCount: 2`
- All processors use structured logging via `@phyne/logging` (pino JSON output)

## Docker
- `docker/docker-compose.yml` — Local dev (Postgres + Redis)
- `docker/docker-compose.prod.yml` — Production (web + worker + Postgres + Redis with health checks)
- `docker/Dockerfile.web` — Multi-stage Next.js standalone build
- `docker/Dockerfile.worker` — Multi-stage BullMQ worker build
- `apps/web/next.config.ts` has `output: 'standalone'`

## CI/CD
- `.github/workflows/ci.yml` — lint + typecheck + test (parallel) → build
- `.github/workflows/e2e.yml` — Playwright with Postgres/Redis services

## Local Development
```bash
docker compose -f docker/docker-compose.yml up -d  # Start Postgres + Redis
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

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
- **Tooling**: Biome (lint/format), Vitest + Playwright (test), husky (pre-commit hooks)

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
.husky/           — Pre-commit hooks (file size enforcement)
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
- **Routing**: `/` is the public marketing landing page (static); dashboard lives at `/overview` behind auth; middleware allows `/` and `/demo` unauthenticated
- **Demo mode**: Cookie-based (`phyne-demo={sessionId}`, httpOnly, 4h expiry). `/demo` route generates session, seeds per-session tenant (`demo-{sessionId}`), redirects to `/overview`. Demo users get admin role, isolated tenant. `/demo/exit` clears cookie. Dashboard layout shows DemoBanner + DEMO badge in sidebar. Cleanup via BullMQ job (every 1h, removes data > 4h old)
- **Demo seed**: `seedDemoTenant(sessionId)` in `apps/web/src/lib/demo-seed.ts` — transaction orchestrator importing data builders from `demo-seed/data-builders.ts`; creates user, pipeline, 6 stages, 5 contacts, 3 leads, 3 opps, 2 quotes, 2 orders, 2 offers, 2 campaigns, 4 conversions, 3 visitor sessions, 4 page views, 5 scoring rules, 3 external references, 4 stage transitions, 4 activities, 2 notes, 3 tags, 1 notification (~63 rows). Leads/opps/quotes/orders backdated across 25 days for analytics trends. All IDs prefixed with `demo-{sessionId}`. Wrapped in transaction
- **Demo auth injection**: Both `getServerCaller()` and tRPC route handler check for demo cookie; if present and no real session, use `createDemoAuth(sessionId)` as auth context
- **Feature flags**: `getFeatureFlags()` returns frozen copy; `setFeatureFlags()` throws in production
- **Auth safety**: `AUTH_BYPASS=true` blocked in production via Zod superRefine
- **Error handling**: Structured errors (`ServiceError`, `NotFoundError`, `ValidationError`, `FederationError`, `ConflictError`) in `packages/services/src/errors.ts`
- **Tezca webhook events**: `interest.created` (feature interest → contact + lead + drip), `newsletter.subscribed` (newsletter signup → contact + lead + drip). Both enqueue `email-drip` BullMQ job on lead creation
- **Janua webhook linking**: `user.created` checks for existing contact by email (from newsletter/interest) and links `externalJanuaId` instead of creating duplicate
- **Webhook security**: Rate limiting (Redis sliding window, 100 req/min/IP) + HMAC-SHA256 + timestamp validation via shared handler (`apps/web/src/lib/webhooks/handler.ts`); all 6 webhook routes use the shared handler
- **Structured logging**: `@phyne/logging` package (pino); all worker processors and webhook handler use structured JSON logging
- **Signal propagation**: All 6 federation providers accept optional `signal?: AbortSignal` parameter, with config-driven fallback timeouts
- **Owner-scoped queries**: `list()` accepts optional `filters?: { ownerId?: string }`; `listMine` router procedures auto-scope to `ctx.auth.userId`
- **Timeline**: `TimelineService.getTimeline()` merges activities, stage_transitions, and notes into chronological `TimelineEntry[]`
- **Weighted pipeline**: `AnalyticsService.getWeightedPipelineValue()` computes `sum(value * probability / 100)` for open opps
- **At-risk deals**: `AnalyticsService.getAtRiskDeals()` flags opps stuck > threshold days or > 1.5× avg stage velocity
- **Notifications**: Owner assignment triggers non-blocking notification creation in leads/opportunities `update()`
- **tRPC rate limiting**: Redis sliding window, 200 req/min per IP via `checkApiRateLimit()` in `apps/web/src/lib/rate-limiter.ts`; wraps the tRPC route handler (not Edge middleware — ioredis incompatible with Edge Runtime)
- **Security headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy` via `next.config.ts` `headers()`
- **Feature flag enforcement**: 5 gated routers (lead-scoring, visitor-tracking, analytics, offers, campaigns) check `isFeatureEnabled()` at the top of each procedure; throw `TRPCError({ code: 'PRECONDITION_FAILED' })` when disabled
- **Bulk array caps**: `bulkUpdateStatus` on leads/opportunities capped at `.max(100)` items via Zod
- **Seed guard**: `seed.ts` exits with error when `NODE_ENV=production`
- **Seed architecture**: `packages/db/src/seed.ts` is a thin entry point; 14 sub-seeders live in `packages/db/src/seed/` (types, users-pipeline, contacts, leads-opps, quotes-orders, activities-notes, offers-campaigns, conversions, visitor-data, scoring-rules, external-refs, stage-transitions, preferences, tags-notifications, tablaco); orchestrator in `seed/index.ts`
- **Demo seed architecture**: `apps/web/src/lib/demo-seed.ts` is a transaction orchestrator (~80 lines); 19 pure data builder functions live in `demo-seed/data-builders.ts`
- **Demo federation data**: `UnifiedProfileService` returns mock federation data for demo tenants (`demo-*` tenantId) via `demo-federation-data.ts` — no external API calls in demo mode
- **Mock federation fallback**: When all 6 providers return `unavailable` and the contact has a known `externalJanuaId`, `UnifiedProfileService` falls back to mock data via `mock-federation-registry.ts` — makes federation tabs work in local dev without external services
- **Tablaco federation data**: `tablaco-federation-data.ts` provides Tablaco-specific mock data for all 6 providers; dispatched from both `demo-federation-data.ts` (by `externalJanuaId`) and `mock-federation-registry.ts` (dev fallback)
- **Pre-commit hook**: husky pre-commit checks staged `.ts`/`.tsx` files (excludes tests, migrations, generated files); warns at 600 lines, blocks at 800 lines
- **File size limits**: Source files should stay under 600 lines; pre-commit blocks commits with files over 800 lines
- **Delete confirmations**: Offers, campaigns, and scoring rules use confirmation dialogs (no direct inline mutation)
- **Scoring rules CRUD UI**: Full create/edit/delete dialogs in `components/scoring/`
- **Pipeline CRUD**: Full create/update/delete for pipelines and stages; delete rejects default pipeline (`ValidationError`) and pipelines/stages with FK references (`ConflictError`); reorder stages via transaction
- **Multiple pipelines**: Seed creates "Default Sales Pipeline" (6 stages) + "Project Delivery" pipeline (Proposal → Scoping → Development → QA → Delivery → Support); Kanban page fetches all pipelines via `list()` and selects by `searchParams.pipelineId` or defaults to `isDefault: true`
- **Tablaco seed data**: `seed-tablaco.ts` seeds a full project lifecycle: contact (Rodrigo Tablaco, `externalJanuaId: janua-tablaco-001`), converted lead, $45k opportunity on Delivery pipeline, 3 installment quotes, 3 orders (2 fulfilled, 1 confirmed), 6 activities, 4 notes, 4 tags, 6 external refs (all 6 providers), 2 conversions, 5 stage transitions, 2 visitor sessions, 4 page views
- **Time-series analytics**: 4 trend methods (`getLeadTrend`, `getOpportunityTrend`, `getConversionTrend`, `getVisitorTrend`) using `date_trunc()` + GROUP BY with required date range and `day`/`week`/`month` bucketing
- **CSV import**: `ContactsService.bulkCreate()` (max 500, wrapped in transaction); CSV parser handles RFC 4180 (quoted commas, BOM)
- **Task reminders**: Repeatable BullMQ job (`task-reminders`, every 4h) scans activities due within 24h, creates notifications with 24h dedup; see ADR-006
- **Order fulfillment → opp won**: When order status changes to `fulfilled` and `opportunityId` is set, auto-marks linked opportunity as `won` + records `opportunity_to_won` conversion in transaction; non-blocking try/catch pattern
- **EntityType**: `'contact' | 'lead' | 'opportunity' | 'order' | 'quote'` — timeline, notes, tags, activities all support quotes and orders; DB columns are varchar (not enum)
- **Quote/order analytics**: `getQuoteFunnel()`, `getOrderFunnel()`, `getQuoteToOrderRate()` — aggregate by status with soft-delete filtering
- **Landing page**: Hero with CSS-only dashboard mockup (browser frame + KPI cards + chart + table), "Try Live Demo" CTA. Social proof section with factual metrics. 11 marketing sections total
- **Lead scoring refactoring**: `computeScore()` decomposed into private methods (`fetchVisitorData`, `matchCondition`, `matchPageUrl`, `addToCategory`, `computeCategoryScores`, `upsertScore`)
- **At-risk deals refactoring**: `getAtRiskDeals()` decomposed into `computeTransitionMetrics`, `computeStageAverages`, `identifyAtRiskDeals`
- **ServiceError mapping**: tRPC middleware auto-maps `ServiceError` subclasses to proper tRPC error codes (NOT_FOUND→NOT_FOUND, VALIDATION_ERROR→BAD_REQUEST, CONFLICT→CONFLICT, FEDERATION_ERROR→INTERNAL_SERVER_ERROR)
- **Fail-closed rate limiting**: Both API and webhook rate limiters deny requests when Redis is unavailable (fail closed, not fail open)
- **CI TODO**: Configure GitHub branch protection to require `e2e` workflow as required status check, or merge E2E into `ci.yml` as a dependent job

## DB Schema
users, contacts, leads, opportunities, quotes, orders, pipelines, pipeline_stages, activities, notes, notifications, tags, taggables, external_references, role_preferences, webhook_events, visitor_sessions, visitor_page_views, offers, campaigns, conversions, stage_transitions, health_snapshots, lead_scoring_rules, lead_scores, grant_opportunities, grant_applications, grant_signal_audit

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
- quotes: `opportunity_id`, `contact_id`
- orders: `opportunity_id`, `contact_id`, `quote_id`
- lead_scores: unique `lead_id`
- notifications: `user_id`, composite `(user_id, is_read)`

### Soft Delete Columns
- contacts, leads, opportunities, quotes, orders: `deleted_at` (nullable timestamp)

## tRPC Routers
contacts (+ listMine, bulkCreate), leads (+ listMine, listByContactId, bulkUpdateStatus), opportunities (+ listMine, listByContactId, bulkUpdateStatus), quotes (+ listMine, listByOpportunityId, listByContactId), orders (+ listMine, listByOpportunityId, listByContactId, listByQuoteId), pipelines (+ create, update, delete, createStage, updateStage, deleteStage, reorderStages), activities (list, listMine, listForEntity, create, update, delete, complete), notes (listForEntity, create, update, delete, togglePin), tags (list, create, delete, addToEntity, removeFromEntity, getForEntity), users (admin-gated: list, getById, create, update, delete), search (search), unified-profile, federation-health, visitor-tracking, offers, campaigns, conversions, analytics (+ weightedPipelineValue, atRiskDeals, leadTrend, opportunityTrend, conversionTrend, visitorTrend, quoteFunnel, orderFunnel, quoteToOrderRate, with date range filtering), lead-scoring, preferences (getForRole, upsert), timeline (getTimeline), notifications (list, unreadCount, markAsRead, markAllAsRead), grants (listOpportunities, getOpportunity, listApplications, getApplication, createApplication, moveToStage, requestHitlApproval, approveSubmission, rejectSubmission, markSubmitted, markAwarded, getAuditTrail, getPipelineStats — all gated by `treasuryHunter` flag)

## Feature Flags (13 total)
- `federationReadOnly: true` — Phase 1 read-only SPOG
- `forjEnabled: true` — Forj 3D digital assets provider
- `visitorTracking: true` — Anonymous visitor tracking via Janua telemetry
- `funnelManagement: true` — Funnel and offer management
- `analytics: true` — Analytics dashboard
- `leadScoring: true` — Configurable lead scoring with auto-recomputation
- `treasuryHunter: false` — ACCA Treasury Hunter grant lifecycle management (Fortuna → PhyneCRM → Karafiel pipeline)
- 6 others (bidirectionalSync, aiKanban, multiTenancy, piiMasking, observability, realtimeUpdates) — all `false`

## Phasing
- Phase 1 (MVP): Single-tenant, read-only federation + visitor tracking + offers + analytics + lead scoring
- Phase 2: Bidirectional sync, AI Kanban
- Phase 3: Multi-tenant SaaS

## Frontend Features
- **Dark mode**: next-themes with `.dark` class selector (globals.css); ThemeToggle in header
- **Mobile nav**: Sheet-based sidebar (slides from left, auto-close on route change)
- **Sidebar icons**: Lucide icons via shared `navigation.ts` module
- **Loading skeletons**: `TableSkeleton`, `CardSkeleton` + Next.js `loading.tsx` files for all 15 dashboard pages (contacts, leads, opportunities, pipeline, activities, visitors, funnel, offers, campaigns, settings, settings/scoring, settings/users, settings/pipelines, clients/[id], overview/analytics)
- **Error pages**: Global `error.tsx`, `not-found.tsx`, dashboard-scoped `error.tsx`/`loading.tsx`
- **Data table search/filter**: Client-side search + status filter on contacts, leads, opportunities, visitors, offers, campaigns
- **Radix Select**: All dropdowns use `@radix-ui/react-select` (not native `<select>`)
- **Polling**: `refetchInterval` on data tables (60s leads/opps/activities, 120s contacts)
- **Analytics charts**: recharts (ConversionFunnelChart, PipelineVelocityChart, RevenueByStatusChart, TrendLineChart)
- **Analytics trends**: Time-series trend charts (leads, opps, conversions, visitors) with date range picker and day/week/month bucketing at `/analytics`
- **Activities page**: Server-rendered with full `ActivitiesDataTable` (create/edit/delete/complete via dialogs)
- **Notes panel**: Per-entity notes (contact/lead/opportunity) with create/edit/delete/pin toggle
- **Tags panel**: Per-entity tags with add/remove, badge display, create new tags with color
- **User management**: Admin-gated CRUD at `/settings/users`
- **Global search**: Cmd+K searchbar in header, searches contacts/leads/opportunities with debounced query
- **Kanban pipeline**: Drag-and-drop pipeline board using `@hello-pangea/dnd`, moves leads/opps between stages; pipeline selector dropdown (`PipelineSelector`) switches between pipelines via `?pipelineId=` search param
- **Contact detail**: Federation tabs + activities + notes + tags + related leads/opportunities
- **Dashboard charts**: ConversionFunnelChart + RevenueByStatusChart on overview page, plus recent activities
- **Bulk operations**: Row selection checkboxes on data tables, bulk status change for leads/opportunities
- **CSV export**: Export contacts/leads/opportunities to CSV (all or selected rows)
- **CSV import**: Import contacts from CSV with column mapping UI (`/contacts` page, max 500 per import)
- **Pipeline settings**: Full pipeline and stage CRUD at `/settings/pipelines` with drag-to-reorder stages via `@hello-pangea/dnd`
- **Owner column**: Leads and opportunities tables show owner name, edit dialogs have owner select
- **Health endpoint**: `GET /api/health` returns `{ status: 'ok', timestamp }` for Docker health checks
- **Lead detail page**: `/leads/[id]` — info card + timeline + notes + tags
- **Opportunity detail page**: `/opportunities/[id]` — info card + timeline + notes + tags
- **Notification bell**: In header, polls unreadCount every 30s, click navigates to entity
- **My Deals toggle**: Segmented button on leads/opportunities tables to switch between owner-scoped and all records
- **Stage names**: Data tables resolve stageId to human-readable stage name via pipeline stages lookup
- **Offers CRUD**: Full create/edit/delete with enhanced create form (value, currency, dates, max redemptions); delete uses confirmation dialog
- **Campaigns page**: Full CRUD data table with create/edit/delete, channel badges, UTM tracking, linked offers, budget/spend; delete uses confirmation dialog
- **Scoring rules CRUD**: Full create/edit/delete UI at `/settings/scoring` with edit-scoring-rule-dialog, delete-scoring-rule-dialog
- **Quotes page**: Full CRUD data table at `/quotes` with My/All toggle, CSV export, delete confirmation dialog, status badges (draft/sent/accepted/declined/expired)
- **Quotes detail**: `/quotes/[id]` — info card + related orders + timeline + notes + tags
- **Orders page**: Full CRUD data table at `/orders` with My/All toggle, CSV export, delete confirmation dialog, status badges (pending/confirmed/in_production/fulfilled/cancelled)
- **Orders detail**: `/orders/[id]` — info card (linked quote, opportunity, contact) + timeline + notes + tags
- **Opportunity detail**: Shows related quotes and orders sections with links to detail pages
- **Contact detail**: Shows related quotes and orders sections alongside existing leads/opportunities
- **Dashboard KPIs**: Open Quotes and Active Orders cards on overview page
- **Quote/order funnel chart**: Recharts BarChart on analytics page showing quote/order status breakdown
- **Demo mode UX**: DemoBanner (gradient bar with Sign Up/Exit Demo), DEMO badge in sidebar, "Demo Visitor" in header, "Exit Demo" replaces sign-out button
- **Landing page**: 11 marketing sections: Navbar, Hero (CSS-only DashboardPreview + "Try Live Demo" CTA), PainPoints, Features, EcosystemDiagram, HowItWorks, SocialProof (factual metrics), ComparisonTable, Pricing, CTA ("Try Live Demo"), Footer ("Live Demo" link)
- **Navigation**: 14 entries (Clients removed — redirects to /contacts; Campaigns with Megaphone icon; Quotes with FileText icon; Orders with Package icon)
- **DB migrations**: Generated via `pnpm db:generate`, stored in `packages/db/src/migrations/`; quotes + orders migration generated (25 tables)

## Worker Processors
- `health-check`: Calls `checkAll()` and persists results to `healthSnapshots` table
- `session-identify`: Wired with real DB + `VisitorTrackingService.upsertFromWebhook()`
- `lead-scoring`: Wired with real DB + `LeadScoringService.batchCompute()`
- `cache-warmup`: Pre-fetches federation data for given external IDs
- `federation-sync`: Handles cache invalidation and refresh
- `task-reminders`: Repeatable job (every 4h) scanning activities due within 24h, creates notifications with dedup
- `demo-cleanup`: Repeatable job (every 1h) deleting expired demo tenant data > 4h old; deletes all 20 entity types in dependency order within transaction (5 phases: leaf entities → referencing entities → core entities → campaigns/offers → pipeline/user)
- `grant-compliance-check`: Calls Karafiel `/api/v1/grants/compliance-status/{rfc}/` to verify 32-D, RFC status, blacklist; updates `complianceChecks` JSON on grant_application (ACCA Treasury Hunter)
- `email-drip`: 4-step drip sequence via Resend (Day 0: welcome, Day 2: legal tip, Day 5: trial invite, Day 14: last chance). Triggered on lead creation from Tezca newsletter/interest events. Each step self-enqueues the next with BullMQ delayed jobs. Dedup by `drip-{leadId}-step-{N}` job ID
- **LLM routing**: Reddit bot `RedditBotService` supports `OPENAI_BASE_URL` for routing completions through AutoSwarm Nexus (`/v1` OpenAI-compatible endpoint). When unset, falls back to direct OpenAI. Both `web` and `worker` services receive the env var in `docker-compose.prod.yml`
- All workers have `completed`/`failed`/`stalled` event handlers + `maxStalledCount: 2`
- All processors use structured logging via `@phyne/logging` (pino JSON output)

## ACCA Treasury Hunter Integration
- **Fortuna webhook**: `POST /api/webhooks/fortuna` — receives `grant.discovered` events, upserts grant_opportunities, creates grant_application at "Discovered" stage, enqueues `grant-compliance-check` job
- **Karafiel webhook dispatch**: `grant.awarded` event sent when application reaches "Awarded" status (HMAC-SHA256, `X-PhyneCRM-Signature`)
- **HITL gate**: `approveSubmission` requires real `userId` + passing compliance checks (`rfc_active`, `opinion_32d_positive`, `!blacklisted`)
- **Pipeline**: "Treasury Hunter" pipeline with 8 stages: Discovered (5%) → Evaluating (15%) → Preparing (30%) → HITL Review (50%) → Submitted (65%) → Under Evaluation (75%) → Awarded (95%) → Rejected (0%)
- **Audit trail**: `grant_signal_audit` table records all lifecycle events with actor + details

## Docker
- `docker/docker-compose.yml` — Local dev (Postgres + Redis)
- `docker/docker-compose.prod.yml` — Production (web + worker + Postgres + Redis with health checks); `JANUA_TELEMETRY_API_URL` in both web and worker
- `docker/Dockerfile.web` — Multi-stage Next.js standalone build
- `docker/Dockerfile.worker` — Multi-stage BullMQ worker build
- `apps/web/next.config.ts` has `output: 'standalone'` + security headers
- `.dockerignore` — Excludes `.git`, `node_modules`, test files, `.env*`, coverage from Docker build context

## CI/CD
- `.github/workflows/ci.yml` — lint + typecheck + test (parallel) → build; `JANUA_TELEMETRY_API_URL` in build env
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

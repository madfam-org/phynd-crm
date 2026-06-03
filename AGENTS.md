# Phynd Crm Agent Operating Guide

> [!IMPORTANT]
> MADFAM-ENCLII-FIRST-LEGACY-RAW v1: This document contains legacy raw infrastructure command examples.
> Routine production operations must use Enclii web, API, or CLI. Treat raw
> `kubectl`, `helm`, SSH, provider CLI/API, `docker exec`, and direct container
> access as platform bootstrap or documented break-glass only, and record any
> missing Enclii adapter gap.


<!-- MADFAM-AGENTS-CANONICAL v1 -->

This is the canonical instruction file for Claude, Codex, and any other LLM
agent working in this repository. `CLAUDE.md` is kept only as a compatibility
redirect and should not become the source of truth again.

## Required operating doctrine

- Read this file before making repo changes.
- Prefer existing repo conventions, scripts, and docs over introducing new
  patterns.
- Preserve user work and never revert unrelated changes.
- Treat production operations as Enclii-first: use Enclii web, API, or CLI for
  provisioning, deployment, observability, domains, secrets, provider
  operations, scaling, rollback, and remediation.
- Use direct `kubectl`, `helm`, SSH, provider CLIs/APIs, `docker exec`, or
  direct container access only for platform bootstrap or documented break-glass
  emergencies when Enclii is unavailable or lacks an implemented adapter.
- Record any missing Enclii adapter gap instead of normalizing raw production
  access in docs or runbooks.

## Repo entrypoints

- `README.md`
- `ECOSYSTEM.md`
- `docs/ROADMAP.md` — canonical phase map and gap scorecard
- `docs/MADFAM_TRUTH_LAYER_REMEDIATION.md` — executable workstreams WS0–WS9
- `docs/runbooks/` — operator runbooks (`PILOT_GO_LIVE.md`, `TABLACO_ENGAGEMENT.md`)
- `infra/`
- `.github/workflows/`

## LLM context files

- `llms.txt` is the compact context index.
- `llms-full.txt` is the durable full-context map and operating contract.
- `AGENTS.md` is canonical for agent instructions.
- `CLAUDE.md` redirects here for Claude compatibility.

## Maintenance

Regenerate or repair these files with
`internal-devops/scripts/sync-agent-docs.py` from the labspace ecosystem.

---

## Legacy CLAUDE.md guidance imported on 2026-05-13

<!-- BEGIN LEGACY_CLAUDE_IMPORT -->

# Phynd CRM - Project Instructions

## Overview
Phynd is a phygital CRM — "Synthetic Single Pane of Glass" that federates data from 6 MADFAM ecosystem platforms (Janua, Janua Telemetry, Dhanam, Cotiza, PravaraMES, Forj) without duplicating it. All 6 providers are active.

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
.github/workflows — CI/CD (ci.yml, e2e.yml, deploy-web.yml, deploy-worker.yml)
docker/           — Dockerfile.web, Dockerfile.worker, docker-compose.yml, docker-compose.prod.yml
infra/k8s/        — Kubernetes production manifests (Kustomize)
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
pnpm verify:pilot-go-live   # Pre-flight bundle (migrations, PP5, Selva probe)
pnpm pp5:pilot-ops          # Operator checklist (automated + manual Enclii steps)
pnpm verify:post-deploy     # Live health smoke (set CRM_BASE_URL)
pnpm db:migrate:tier        # Apply tier migrations (DATABASE_URL required)
pnpm verify:janua-oidc     # Janua OIDC redirect URI checklist (Phase 0)
pnpm verify:selva-agent     # Selva service-token integration smoke test
```

## Key Patterns
- **Federation**: `Promise.allSettled()` across 6 providers — partial failures don't block. Each provider has a dedicated contract test at `packages/federation/src/providers/<name>/__tests__/contract.test.ts` that asserts the raw response shape against a JSON Schema AND the `.map()` transformation. 115 tests total in the federation package (35 added 2026-04-17 to close ECOSYSTEM_AUDIT §6.6). Shared validator at `packages/federation/src/__tests__/contract-helpers.ts` (no ajv dep).
- **Cache**: Redis with tenant-namespaced keys (`phynd:{tenantId}:fed:{provider}:{id}`)
- **Circuit Breaker**: CLOSED → OPEN (5 failures/60s) → HALF_OPEN (30s) → CLOSED (3 successes); shared CB instances between FederationClient and HealthChecker
- **Timeout**: Config-driven via `ProviderConfig.timeout` → `AbortSignal.timeout()` passed to provider `fetch()`; providers accept optional `signal` parameter
- **tenantId**: Resolved from an explicit service-context argument, then `auth.tenantId`, then `DEFAULT_TENANT_ID` (default `'madfam'`)
- **No .js extensions**: Relative imports use extensionless paths for bundler compatibility
- **Pagination**: Cursor-based — services accept `PaginationInput { cursor?, limit? }` and return `PaginatedResult<T> { items, nextCursor, hasMore }`
- **Soft deletes**: contacts, leads, opportunities use `deletedAt` column; `list()`/`getById()` filter `isNull(deletedAt)`; `delete()` sets `deletedAt` instead of hard delete
- **Transactions**: Multi-table mutations (lead create + conversion, opportunity create/won + conversion, offer auto-redemption) are wrapped in `db.transaction()`
- **Auto-conversion tracking**: Lead/opportunity creation and status changes auto-record conversion events; conversions auto-redeem linked campaign offers
- **Lead scoring**: Configurable rules engine evaluating conditions against lead + visitor session + page view data; auto-recomputes on lead create, status change, and visitor identify; breakdown keyed by rule ID (not name)
- **Scoring conditions**: source, status, session_count, page_view_count, has_contact, page_url (contains/eq), 3d_asset_views (forj:// URL scheme)
- **Fabrication activities**: PravaraMES webhook auto-creates CRM activities on fabrication status changes
- **Routing**: `/` is the public marketing landing page (static); dashboard lives at `/overview` behind auth; middleware allows `/` and `/demo` unauthenticated
- **Demo mode**: Cookie-based (`phynd-demo={sessionId}`, httpOnly, 4h expiry). `/demo` route generates session, seeds per-session tenant (`demo-{sessionId}`), redirects to `/overview`. Demo users get admin role, isolated tenant. `/demo/exit` clears cookie. Dashboard layout shows DemoBanner + DEMO badge in sidebar. Cleanup via BullMQ job (every 1h, removes data > 4h old)
- **Demo seed**: `seedDemoTenant(sessionId)` in `apps/web/src/lib/demo-seed.ts` — transaction orchestrator importing data builders from `demo-seed/data-builders.ts`; creates user, pipeline, 6 stages, 5 contacts, 3 leads, 3 opps, 2 quotes, 2 orders, 2 offers, 2 campaigns, 4 conversions, 3 visitor sessions, 4 page views, 5 scoring rules, 3 external references, 4 stage transitions, 4 activities, 2 notes, 3 tags, 1 notification (~63 rows). Leads/opps/quotes/orders backdated across 25 days for analytics trends. All IDs prefixed with `demo-{sessionId}`. Wrapped in transaction
- **Demo auth injection**: Both `getServerCaller()` and tRPC route handler check for demo cookie; if present and no real session, use `createDemoAuth(sessionId)` as auth context
- **Feature flags**: `getFeatureFlags()` returns frozen copy; `setFeatureFlags()` throws in production. Production may opt into gated features via env only: `FEATURE_TREASURY_HUNTER`, `FEATURE_OBSERVABILITY`, `FEATURE_PII_MASKING`, `FEATURE_AI_KANBAN` (see `packages/config/src/features.ts`)
- **Auth safety**: `AUTH_BYPASS=true` blocked in production via Zod superRefine
- **Federation token auth**: Service-to-service tRPC and GraphQL calls via `FEDERATION_API_TOKEN` env var. If request `Authorization: Bearer <token>` matches, creates `SERVICE_AUTH` context (`userId: 'service:selva'` via `FEDERATION_SERVICE_USER_ID`, `roles: ['service']`, scopes: `leads:read`, `activities:read`, `contacts:read`, `opportunities:read`, `unifiedProfile:read`, `engagements:read`, `search:read`, `analytics:read`, `aiKanban:write`) bypassing Auth.js session check. Shared resolver `createAppContextFromRequest()` in `apps/web/src/lib/trpc/request-context.ts`. Structured audit log on each service-auth request (`web:trpc:service-auth`, field `surface`: `trpc` | `graphql`). `enforceServiceScopes` middleware rejects out-of-scope tRPC procedures. Rate limiting still applies. Empty/unset token disables the path
- **Error handling**: Structured errors (`ServiceError`, `NotFoundError`, `ValidationError`, `FederationError`, `ConflictError`) in `packages/services/src/errors.ts`
- **Tezca webhook events**: `interest.created` (feature interest → contact + lead + drip), `newsletter.subscribed` (newsletter signup → contact + lead + drip). Both enqueue `email-drip` BullMQ job on lead creation
- **Janua webhook linking**: `user.created` checks for existing contact by email (from newsletter/interest) and links `externalJanuaId` instead of creating duplicate
- **Webhook security**: Rate limiting (Redis sliding window, 100 req/min/IP) + HMAC-SHA256 + timestamp validation via shared handler (`apps/web/src/lib/webhooks/handler.ts`); all 6 tenant-side webhook routes use the shared handler
- **RouteCraft webhook** (`apps/web/src/app/api/webhooks/routecraft/route.ts`): ecosystem payment attribution endpoint — counterpart to `@routecraft/payments::emitPaymentSucceeded`. Uses `validateMadfamSignature()` from `@phynd/federation` (Stripe-style `t=<ts>,v1=<hex>` header, 5-min replay window, timing-safe compare). Idempotent via `webhook_events.payload->>'event_id'` lookup. Tenant via `resolveTenantIdForWebhook()`. Inserts a `conversions` row (`type='ecosystem_payment_succeeded'`) with attribution in metadata; links `contactId` via `externalJanuaId` = `attribution.source_agent_id` and `campaignId` via `campaigns.utm_campaign` = `attribution.campaign_id` when resolvable. Secret: `PHYND_CRM_EVENTS_SECRET` (when unset → 503)
- **Tenant resolution**: `apps/web/src/lib/http/tenant-context.ts` — host-derived `tenantId` for tRPC, GraphQL, and webhooks (`madfam` for `crm.madfam.io` / `phynd.app` brands)
- **Staging outbound guard**: `packages/config/src/outbound-guard.ts` — when `PHYND_DEPLOYMENT_TIER=staging`, blocks outbound calls to production MADFAM hosts (Karafiel grant dispatch, Cotiza engagement emitter, Pravara/Selva production dispatch)
- **Structured logging**: `@phynd/logging` package (pino); all worker processors and webhook handler use structured JSON logging
- **Signal propagation**: All 6 federation providers accept optional `signal?: AbortSignal` parameter, with config-driven fallback timeouts
- **Owner-scoped queries**: `list()` accepts optional `filters?: { ownerId?: string }`; `listMine` router procedures auto-scope to `ctx.auth.userId`
- **Timeline**: `TimelineService.getTimeline()` merges activities, stage_transitions, and notes into chronological `TimelineEntry[]`
- **Weighted pipeline**: `AnalyticsService.getWeightedPipelineValue()` computes `sum(value * probability / 100)` for open opps
- **At-risk deals**: `AnalyticsService.getAtRiskDeals()` flags opps stuck > threshold days or > 1.5× avg stage velocity
- **Notifications**: Owner assignment triggers non-blocking notification creation in leads/opportunities `update()`
- **tRPC rate limiting**: Redis sliding window, 200 req/min per IP via `checkApiRateLimit()` in `apps/web/src/lib/rate-limiter.ts`; wraps the tRPC route handler (not Edge middleware — ioredis incompatible with Edge Runtime)
- **Security headers**: `X-Frame-Options: DENY` (middleware; relaxed to CSP `frame-ancestors` on dashboard routes when `PHYND_SELVA_EMBED_ALLOWED=true`), `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy` via `next.config.ts` + middleware
- **Feature flag enforcement**: 5 gated routers (lead-scoring, visitor-tracking, analytics, offers, campaigns) check `isFeatureEnabled()` at the top of each procedure; throw `TRPCError({ code: 'PRECONDITION_FAILED' })` when disabled
- **Bulk array caps**: `bulkUpdateStatus` on leads/opportunities capped at `.max(100)` items via Zod
- **Seed guard**: `seed.ts` exits with error when `NODE_ENV=production`
- **Seed architecture**: `packages/db/src/seed.ts` is a thin entry point; 14 sub-seeders live in `packages/db/src/seed/` (types, users-pipeline, contacts, leads-opps, quotes-orders, activities-notes, offers-campaigns, conversions, visitor-data, scoring-rules, external-refs, stage-transitions, preferences, tags-notifications, tablaco); orchestrator in `seed/index.ts`
- **Demo seed architecture**: `apps/web/src/lib/demo-seed.ts` is a transaction orchestrator (~80 lines); 19 pure data builder functions live in `demo-seed/data-builders.ts`
- **Demo federation data**: `UnifiedProfileService` returns mock federation data for demo tenants (`demo-*` tenantId) via `demo-federation-data.ts` — no external API calls in demo mode
- **Mock federation fallback**: When all 6 providers return `unavailable` and the contact has a known `externalJanuaId`, `UnifiedProfileService` falls back to mock data via `mock-federation-registry.ts` — **disabled in production** (`NODE_ENV !== 'production'` guard); makes federation tabs work in local dev without external services
- **PII masking for service auth**: When `piiMasking` flag is on, `SearchService` and `UnifiedProfileService` mask email/phone fields for `service:` actors (Selva agent reads)
- **Tablaco federation data**: `tablaco-federation-data.ts` provides Tablaco-specific mock data for all 6 providers; dispatched from both `demo-federation-data.ts` (by `externalJanuaId`) and `mock-federation-registry.ts` (dev fallback)
- **Pre-commit hook**: husky pre-commit checks staged `.ts`/`.tsx` files (excludes tests, migrations, generated files); warns at 600 lines, blocks at 800 lines
- **File size limits**: Source files should stay under 600 lines; pre-commit blocks commits with files over 800 lines
- **Delete confirmations**: Offers, campaigns, scoring rules, leads, and opportunities use confirmation dialogs (no direct inline delete)
- **Scoring rules CRUD UI**: Full create/edit/delete dialogs in `components/scoring/`
- **Pipeline CRUD**: Full create/update/delete for pipelines and stages; delete rejects default pipeline (`ValidationError`) and pipelines/stages with FK references (`ConflictError`); reorder stages via transaction
- **Multiple pipelines**: Seed creates "Default Sales Pipeline" (6 stages) + "Project Delivery" pipeline (Proposal → Scoping → Development → QA → Delivery → Support); Kanban page fetches all pipelines via `list()` and selects by `searchParams.pipelineId` or defaults to `isDefault: true`
- **Tablaco seed data**: `seed-tablaco.ts` seeds a full project lifecycle: contact (Rodrigo Tablaco, `externalJanuaId: janua-tablaco-001`), converted lead, $45k opportunity on Delivery pipeline, 3 installment quotes, 3 orders (2 fulfilled, 1 confirmed), 6 activities, 4 notes, 4 tags, 6 external refs (all 6 providers), 2 conversions, 5 stage transitions, 2 visitor sessions, 4 page views
- **Time-series analytics**: 4 trend methods (`getLeadTrend`, `getOpportunityTrend`, `getConversionTrend`, `getVisitorTrend`) using `date_trunc()` + GROUP BY with required date range and `day`/`week`/`month` bucketing
- **CSV import**: `ContactsService.bulkCreate()` (max 500, wrapped in transaction); CSV parser handles RFC 4180 (quoted commas, BOM)
- **Task reminders**: Repeatable BullMQ job (`task-reminders`, every 4h) scans activities due within 24h, creates notifications with 24h dedup; see ADR-006
- **Order fulfillment → opp won**: When order status changes to `fulfilled` and `opportunityId` is set, auto-marks linked opportunity as `won` + records `opportunity_to_won` conversion in transaction; non-blocking try/catch pattern
- **EntityType**: `'contact' | 'lead' | 'opportunity' | 'order' | 'quote'` — timeline, notes, tags, activities all support quotes and orders; DB columns are varchar (not enum)
- **Quote/order analytics**: `getQuoteFunnel()`, `getOrderFunnel()`, `getQuoteToOrderRate()` — aggregate by status with soft-delete filtering; wired on `/analytics` via `QuoteOrderAnalytics`
- **SKU / Tulana campaign loop** (migrations `0008`, `0009`): `sku_catalog`, `campaign_imports`, `campaign_buyer_signals`; `POST /api/v1/campaigns/import` (HMAC `PHYND_CAMPAIGN_IMPORT_SECRET`), review UI + `campaigns.reviewTulanaImport`, send gates (`campaign-send-gate.ts`, `POST /api/v1/campaigns/send`), buyer signals (`POST /api/v1/campaigns/buyer-signals`). Analytics: `skuCampaignFunnel`, `skuBuyerSignalFunnel`, `paymentAttributionSummary` on `/analytics`
- **Selva engagement webhook**: `POST /api/webhooks/selva` — HMAC `SELVA_WEBHOOK_SECRET`; writes engagement milestones via shared `engagement-writer.ts`
- **Janua Telemetry identify**: `visitor.identified` on `/api/webhooks/janua-telemetry` enqueues `session-identify` BullMQ job (tenant-aware worker)
- **AI Kanban HITL** (Phase 5.5): `ai_kanban_suggestions` table; Selva/service `aiKanban.createSuggestion`; staff approve/reject on `/pipeline` review panel; enable via `FEATURE_AI_KANBAN=true`
- **Landing page**: Hero with CSS-only dashboard mockup (browser frame + KPI cards + chart + table), "Try Live Demo" CTA. Social proof section with factual metrics. 11 marketing sections total
- **Lead scoring refactoring**: `computeScore()` decomposed into private methods (`fetchVisitorData`, `matchCondition`, `matchPageUrl`, `addToCategory`, `computeCategoryScores`, `upsertScore`)
- **At-risk deals refactoring**: `getAtRiskDeals()` decomposed into `computeTransitionMetrics`, `computeStageAverages`, `identifyAtRiskDeals`
- **ServiceError mapping**: tRPC middleware auto-maps `ServiceError` subclasses to proper tRPC error codes (NOT_FOUND→NOT_FOUND, VALIDATION_ERROR→BAD_REQUEST, CONFLICT→CONFLICT, FEDERATION_ERROR→INTERNAL_SERVER_ERROR)
- **Fail-closed rate limiting**: Both API and webhook rate limiters deny requests when Redis is unavailable (fail closed, not fail open)
- **CI status gate**: E2E is now enforced through `.github/workflows/ci.yml` via reusable workflow call to `.github/workflows/e2e.yml` (`e2e` job). Branch protection should require the `CI` workflow checks.

## Tablaco client-engagement flow (2026-04-19)

PhyndCRM is the seam across the MADFAM ecosystem for a single client's cross-platform work (fab + digital). The engagement aggregate + portal shipped with phynd-crm#9 + #10 + #11.

**Engagement aggregate** (3 new tables, migration `0005_medical_genesis.sql`):
- `engagements` — aggregate root tying a client (`contact_id`) to a project family. Optional `opportunity_id` link. Status: active / completed / paused / cancelled.
- `engagement_artifacts` — proposals, invoices, deliverables, NFT receipts. Polymorphic `entity_type/id` matches the existing pattern.
- `engagement_events` — unified project-status stream with `source`, `event_type`, `status`, `message`, `metadata`, `dedup_key`. Ordered by `created_at`, merged with activities + stage_transitions by `EngagementsService.getTimeline()`.

**Ecosystem writes:**
- Cotiza → `POST /api/v1/engagements/events` on quote APPROVED; `POST /api/v1/engagements/artifacts` for the signed-proposal PDF.
- Pravara → existing `/api/webhooks/pravara` also writes `engagement_events` when the payload ties to a contact with an active engagement.
- Selva (future) → will POST milestone completion events the same way.
- Karafiel (future) → will POST CFDI/NOM-151 stamping events.
- All writes HMAC-signed, secret `PHYND_ENGAGEMENT_EVENTS_SECRET`. Idempotent via `dedup_key`.

**External-client portal via Janua magic link (Phase C):**
- Staff calls `engagements.sendPortalLink(engagementId)` tRPC mutation → `EngagementPortalMagicLinkService` calls Janua's `/api/v1/auth/magic-link` with `redirect_url=<PORTAL_BASE_URL>/portal/verify?engagement=<id>`. Janua emails the client (5/hour rate limit, 15-min token expiry).
- Client clicks → `GET /portal/verify?engagement=X&token=Y` exchanges the token via Janua's `/api/v1/auth/magic-link/verify`, double-checks the verified email matches `engagement.contact.email`, seals `phynd-portal-session` httpOnly cookie (14-min TTL, path-scoped to `/portal`), redirects to `/portal/[engagementId]`.
- Portal page (`/portal/[engagementId]`) is server-rendered — reads the cookie, loads timeline + artifacts, renders read-only view with status badge. Fully isolated from the Auth.js v5 staff OIDC session.
- Error / expiry paths redirect to `/portal/expired` with reason-keyed copy.
- `/portal/*` added to middleware `publicPaths` — portal has its own cookie gating.

**New env vars:**
| Var | Purpose |
|---|---|
| `PHYND_ENGAGEMENT_EVENTS_SECRET` | HMAC secret for `/api/v1/engagements/events` + `/artifacts` webhooks (also shared with Cotiza + Pravara + others writing in) |
| `PORTAL_BASE_URL` | Base URL for Janua magic-link `redirect_url`. Defaults to `NEXTAUTH_URL` |
| `JANUA_API_URL` | Janua API base for magic-link calls. Defaults to `AUTH_JANUA_ISSUER` |

**Tests:**
- `packages/services/src/__tests__/engagements.service.test.ts` — 7 tests (recordEvent idempotency, addArtifact, getTimeline merge)
- `packages/services/src/__tests__/engagement-portal-magic-link.service.test.ts` — 11 tests (sendPortalLink, verifyPortalLink, email-match enforcement, Janua response shape handling)

**Tablaco runbook:** see `docs/runbooks/TABLACO_ENGAGEMENT.md`.

**Event taxonomy:** shared vocabulary for milestone events across producers (Cotiza, Pravara, Selva, Karafiel, Dhanam) is defined in [`docs/ENGAGEMENT_EVENT_TAXONOMY.md`](docs/ENGAGEMENT_EVENT_TAXONOMY.md). Canonical milestone names (e.g. `prototype_shipped`, `payment_received`, `cfdi_stamped`) let portal filters work source-agnostically. Producers SHOULD emit both a native `<source>:<native_name>` event and a canonical `<source>:<canonical_name>` alias (separate dedup keys) when a status transition represents a client-visible milestone. Pravara's `/api/webhooks/pravara` is the reference implementation — it writes `pravara:shipped` + `pravara:prototype_shipped` on a single `status=shipped` delivery.

## DB Schema
users, contacts, leads, opportunities, quotes, orders, pipelines, pipeline_stages, activities, notes, notifications, tags, taggables, external_references, role_preferences, webhook_events, visitor_sessions, visitor_page_views, offers, campaigns, conversions, stage_transitions, health_snapshots, lead_scoring_rules, lead_scores, grant_opportunities, grant_applications, grant_signal_audit, engagements, engagement_artifacts, engagement_events, referral_codes, referrals, sku_catalog, campaign_imports, campaign_buyer_signals, ai_kanban_suggestions

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
- engagements: `contact_id`, `opportunity_id`, `status`
- engagement_artifacts: `engagement_id`, `type`
- engagement_events: `engagement_id`, `source`, `created_at`, composite `(engagement_id, dedup_key)` for idempotency
- referral_codes: `owner_janua_id`, unique `code`
- referrals: `referral_code_id`, `referrer_janua_id`, `referred_janua_id`, `status`, partial unique `(referral_code_id, referred_email)`

### Soft Delete Columns
- contacts, leads, opportunities, quotes, orders, engagements: `deleted_at` (nullable timestamp)

## tRPC Routers
contacts (+ listMine, bulkCreate), leads (+ listMine, listByContactId, bulkUpdateStatus), opportunities (+ listMine, listByContactId, bulkUpdateStatus), quotes (+ listMine, listByOpportunityId, listByContactId), orders (+ listMine, listByOpportunityId, listByContactId, listByQuoteId), pipelines (+ create, update, delete, createStage, updateStage, deleteStage, reorderStages), activities (list, listMine, listForEntity, create, update, delete, complete), notes (listForEntity, create, update, delete, togglePin), tags (list, create, delete, addToEntity, removeFromEntity, getForEntity), users (admin-gated: list, getById, create, update, delete), search (search), unified-profile, federation-health, visitor-tracking, offers, campaigns (+ reviewTulanaImport, attemptTulanaSend), conversions, analytics (+ weightedPipelineValue, atRiskDeals, leadTrend, opportunityTrend, conversionTrend, visitorTrend, quoteFunnel, orderFunnel, quoteToOrderRate, skuCampaignFunnel, skuBuyerSignalFunnel, paymentAttributionSummary, with date range filtering), lead-scoring, preferences (getForRole, upsert), timeline (getTimeline), notifications (list, unreadCount, markAsRead, markAllAsRead), grants (listOpportunities, getOpportunity, listApplications, getApplication, createApplication, moveToStage, requestHitlApproval, approveSubmission, rejectSubmission, markSubmitted, markAwarded, getAuditTrail, getPipelineStats — all gated by `treasuryHunter` flag), engagements (list, listByContactId, getById, create, update, delete, listArtifacts, addArtifact, getTimeline, sendPortalLink), referrals, aiKanban (listPending, createSuggestion, approve, reject — gated by `aiKanban` flag; Selva scope `aiKanban:write`)

## Feature Flags (14 total)
- Enabled by default: `bidirectionalSync`, `leadScoring`, `multiTenancy`, `forjEnabled`, `visitorTracking`, `funnelManagement`, `analytics`, `referralManagement`
- Disabled by default: `federationReadOnly`, `aiKanban`, `piiMasking`, `observability`, `realtimeUpdates`, `treasuryHunter` (enable in prod via `FEATURE_TREASURY_HUNTER=true` after staging verification)
- `setFeatureFlags()` still throws in production; use env overrides for gated prod features.

## Phasing

Canonical roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md). Full remediation plan:
[`docs/MADFAM_TRUTH_LAYER_REMEDIATION.md`](docs/MADFAM_TRUTH_LAYER_REMEDIATION.md).

| Phase | Focus | Status |
| --- | --- | --- |
| 0 | Prod Janua SSO + `crm.madfam.io` access for `admin@madfam.io` | Open (Janua OIDC ops) |
| 1 | Data truth + PP.5 env split | Code shipped; ops: [`runbooks/PILOT_GO_LIVE.md`](docs/runbooks/PILOT_GO_LIVE.md) |
| 2 | Engagement seam (Selva + Karafiel events) | Code shipped; provider webhook registration |
| 3 | SKU catalog + Tulana campaign loop | **Shipped** (migrate `0008`/`0009`) |
| 4 | Identity graph + analytics + Treasury Hunter | Code shipped; feature flags off in prod |
| 5 | Selva sales copilot API | **Shipped** — scopes, GraphQL parity, `verify:selva-agent` |

- Host-derived `tenantId` is wired in tRPC, GraphQL, and `getServerCaller()` via `createAppContextFromRequest()`.
- Composite pilot readiness: ~**78–80%** code; remaining gap is Enclii/Janua/provider ops (see pilot runbook).
- Production feature flags still off by default: `treasuryHunter`, `observability` (worker OTel + Sentry; web OTel deferred), `piiMasking`, `aiKanban` — enable per [`PILOT_GO_LIVE.md`](docs/runbooks/PILOT_GO_LIVE.md).

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
- **Health endpoint**: `GET /api/health` returns `{ status: 'ok', service: 'phynd-crm', version: '0.1.0' }` for Docker/Kubernetes/edge health checks
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
- **LLM routing**: Reddit bot `RedditBotService` supports `OPENAI_BASE_URL` for routing completions through Selva Nexus (`/v1` OpenAI-compatible endpoint). When unset, falls back to direct OpenAI. Both `web` and `worker` services receive the env var in `docker-compose.prod.yml`
- **Observability rollout**: `FEATURE_OBSERVABILITY=true` enables OTel on the **worker** (`apps/worker/src/instrumentation.ts`) and Sentry when `SENTRY_DSN` is set. Web OTel deferred — Next.js build still traces gRPC from `@opentelemetry/sdk-node`.
- All workers have `completed`/`failed`/`stalled` event handlers + `maxStalledCount: 2`
- All processors use structured logging via `@phynd/logging` (pino JSON output)

## ACCA Treasury Hunter Integration
- **Fortuna webhook**: `POST /api/webhooks/fortuna` — receives `grant.discovered` events, upserts grant_opportunities, creates grant_application at "Discovered" stage, enqueues `grant-compliance-check` job
- **Karafiel outbound dispatch**: Staff `markAwarded` dispatches `grant.awarded` to `${KARAFIEL_API_URL}/webhooks/phynd-crm` via `dispatchGrantAwarded()` (HMAC `X-PhyndCRM-Signature`); skipped for inbound `service:karafiel-webhook` actors; blocked on staging→prod by outbound guard
- **Karafiel inbound webhook**: `POST /api/webhooks/karafiel` — applies `grant.awarded` from Karafiel without re-dispatch
- **HITL gate**: `requestHitlApproval` → `hitl_pending`; `approveSubmission` requires `hitl_pending` + real `userId` + compliance (`rfc_active`, `opinion_32d_positive`, `!blacklisted`); `markSubmitted` requires `approved_to_submit`; staff `markAwarded` requires `hitlApprovedBy`
- **Pipeline**: "Treasury Hunter" pipeline with 8 stages: Discovered (5%) → Evaluating (15%) → Preparing (30%) → HITL Review (50%) → Submitted (65%) → Under Evaluation (75%) → Awarded (95%) → Rejected (0%)
- **Audit trail**: `grant_signal_audit` table records all lifecycle events with actor + details

## Docker
- `docker/docker-compose.yml` — Local dev (Postgres + Redis)
- `docker/docker-compose.prod.yml` — Production (web + worker + Postgres + Redis with health checks); `JANUA_TELEMETRY_API_URL` in both web and worker
- `docker/Dockerfile.web` — Multi-stage Next.js standalone build
- `docker/Dockerfile.worker` — Multi-stage BullMQ worker build
- `apps/web/next.config.ts` has `output: 'standalone'` + security headers
- `.dockerignore` — Excludes `.git`, `node_modules`, test files, `.env*`, coverage from Docker build context

## Kubernetes (Production)
- `infra/k8s/production/kustomization.yaml` — Kustomize base; deploy pipelines update image digests via `kustomize edit set image`
- `infra/k8s/production/web-deployment.yaml` — Next.js web (port 3000, replicas 1, health probes on `/api/health`)
- `infra/k8s/production/worker-deployment.yaml` — BullMQ worker (health port 3001, replicas 1)
- `infra/k8s/production/web-service.yaml` — ClusterIP service (port 80 → 3000)
- `infra/k8s/production/network-policies.yaml` — Default-deny + allow cloudflared ingress, data namespace egress, HTTPS egress, internal MADFAM service egress
- `infra/k8s/production/resource-quota.yaml` — Namespace limits (1 CPU/2Gi requests, 3 CPU/4Gi limits, 10 pods)
- `infra/k8s/production/pdb.yaml` — Pod Disruption Budget (web minAvailable: 1)
- `infra/k8s/production/secrets-template.yaml` — Template for all env vars (never commit with real values)
- Secrets: `phynd-crm-secrets` (envFrom, required) + `phynd-acca-secrets` (envFrom, optional)
- Images: `ghcr.io/madfam-org/phynd-crm/{web,worker}` with cosign-signed digests

## CI/CD
- `.github/workflows/ci.yml` — lint + typecheck + test (parallel) → build; `JANUA_TELEMETRY_API_URL` in build env
- `.github/workflows/e2e.yml` — Playwright with Postgres/Redis services
- `.github/workflows/deploy-web.yml` — Build + cosign sign + push web image to GHCR; updates `infra/k8s/overlays/staging/kustomization.yaml` digest; Enclii lifecycle callback
- `.github/workflows/deploy-worker.yml` — Build + cosign sign + push worker image to GHCR; updates `infra/k8s/overlays/staging/kustomization.yaml` digest; Enclii lifecycle callback
- `.github/workflows/promote-to-prod.yml` — Manual staging→production promotion; enforces 30m soak + `verify-post-deploy` staging smoke (6×20s) before kustomization sync
- `.github/workflows/rollback-prod.yml` — Manual rollback to previous production digests; re-runs `verify-post-deploy` against prod health URL

## Deployment Pipeline (dev → staging → prod)

PhyndCRM is a **Phase 2** target (lead pipeline priority — the CRM is the
seam across the MADFAM ecosystem webhook graph) for the 3-tier pipeline
defined in
[internal-devops/rfcs/0001-dev-staging-prod-pipeline.md](https://github.com/madfam-org/internal-devops/blob/main/rfcs/0001-dev-staging-prod-pipeline.md).

**Current state:** Staging is now in place. Pushes to `main` for app/package
changes write web and worker digests to
`infra/k8s/overlays/staging/kustomization.yaml`, which ArgoCD tracks via
`infra/argocd/phynd-crm-staging-application.yaml`. Production updates are
manual via `promote-to-prod.yml` with soak + smoke checks; emergency
production reversions use `rollback-prod.yml`.

See [docs/PP_5_STAGING_AUDIT.md](docs/PP_5_STAGING_AUDIT.md) for the current
state and remaining PP.5 follow-up items.

### Known divergences from RFC 0001 (tracked in PP_5_STAGING_AUDIT.md)

| Divergence | Impact | Resolution PR |
|---|---|---|
| Staging subdomain (`staging-phynd.app`) is not yet wired to tunnel/ingress | Can't cross-service smoke-test | Deferred (Cloudflare ops) |
| Inbound/outbound webhook and provider API routing separation is still pending in dependent services | Staging can still point at production destinations | Deferred (service-by-service coordination) |
| Nightly prod→staging masked DB refresh not implemented | Staging DB still needs safe fixture/PII-seeded refresh path | Deferred (RFC 0001 open question) |

### PhyndCRM-specific staging constraints

PhyndCRM is the seam across the MADFAM webhook graph. Unlike single-seam
services, its staging rollout requires coordinated env separation on
**both sides** of every webhook:

- **Inbound webhooks** (Karafiel `grant.awarded`, Fortuna
  `grant.discovered`, Tezca `interest.created` / `newsletter.subscribed`,
  Janua `user.created`, Dhanam billing events, Cotiza / Pravara / Forj
  federation events, RouteCraft payment attribution) — **staging must not
  share prod webhook URLs or HMAC secrets at providers**. Re-registering
  prod webhook URLs wholesale to staging would cross-contaminate lead data
  and grant-application rows. Each provider must register a **second**
  destination for its staging instance → `https://staging-phynd.app/api/webhooks/<provider>` with a **distinct** HMAC secret
  (`KARAFIEL_WEBHOOK_SECRET`, `FORTUNA_WEBHOOK_SECRET`, etc.).

- **Outbound webhooks** (PhyndCRM → Karafiel `grant.awarded`): staging
  PhyndCRM must dispatch to **staging Karafiel**
  (`https://staging-karafiel.madfam.io`) with a distinct staging
  `KARAFIEL_WEBHOOK_SECRET`. Never let staging PhyndCRM call prod
  Karafiel (would create phantom grants in prod).

- **Federation provider API URLs** (`JANUA_API_URL`, `DHANAM_API_URL`,
  `COTIZA_API_URL`, `PRAVARA_BASE_URL`, `FORJ_API_URL`, `TEZCA_API_URL`,
  `KARAFIEL_API_URL`): staging values must point at the provider's
  staging instance when available; interim, point at prod with a
  distinct read-only API key (documented deviation).

- **Drip emails must not reach real prospects from staging.** Resend
  staging API key must be domain-scoped to `@madfam.io` /
  `@staging.madfam.io`. Tezca-side must only emit events for test email
  addresses. `EMAIL_ALLOWLIST_DOMAINS` is implemented in
  `apps/worker/src/processors/email-drip.ts` as a hardening guard.

See `docs/PP_5_STAGING_AUDIT.md` § PhyndCRM-specific staging constraints
for the full staging-secrets template (all 30+ keys) and the per-provider
webhook wiring matrix.

### Promotion pattern

PhyndCRM is **Pattern B — manual gate** per RFC 0001 § Promotion mechanics.
Reasoning: PhyndCRM owns the ACCA Treasury Hunter HITL approval queue +
the customer lead pipeline + the conversions table (partial unique
constraints). A wrong promote can corrupt active grant applications or
silently break the drip worker. `.enclii.yml` declares:

```yaml
promotion:
  pattern: manual
  min_soak_minutes: 30
  require_smoke_pass: true
```

### What currently ships on push to `main`

| Workflow | Trigger | Effect |
|---|---|---|
| `deploy-web.yml` | push to main (apps/web/**, packages/**, pnpm-lock.yaml) | Builds web image, cosign-signs, commits digest to `infra/k8s/overlays/staging/kustomization.yaml` |
| `deploy-worker.yml` | push to main (apps/worker/**, packages/**, pnpm-lock.yaml) | Same shape for worker image |
| `promote-to-prod.yml` | manual | Copies staged digests into `infra/k8s/production/kustomization.yaml` after soak + `verify-post-deploy` smoke |
| `rollback-prod.yml` | manual | Rollbacks target digest(s) in production kustomization; `verify-post-deploy` prod health recheck |

## Local Development
```bash
docker compose -f docker/docker-compose.yml up -d  # Start Postgres + Redis
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Known Issues — Audit 2026-04-23

Source: ecosystem audit dated 2026-04-23 (org-internal — see `internal-devops/audits/`).

- **🟡 T: `/tests` directory exists but contains zero test files** — auth/CRM endpoints untested; 5 auth-related tests appear to be skipped per sweep. Needs a test foundation sprint.
- **🟢 UI: Federation tabs** — `clients/[id]/loading.tsx` + health banner shipped 2026-05-28.
- **🟢 UI: Delete confirmation** — leads/opportunities use confirmation dialogs (2026-05-28).
- **🟢 UI: Sidebar `aria-label`** — desktop + mobile nav links (2026-05-28).
- **🟡 i18n: Monolingual English** — ("Sign Up", "Create", "Edit", "Delete" hardcoded). Adopt next-intl for Mexico market.
- **🟢 positive**: Drizzle `sql<T>` template tags used throughout — zero SQL-injection surface.

<!-- END LEGACY_CLAUDE_IMPORT -->

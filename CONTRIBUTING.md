# Contributing to Phynd CRM

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for Postgres + Redis)

## Setup

```bash
git clone <repo-url>
cd phynd-crm
pnpm install
docker compose -f docker/docker-compose.yml up -d
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Package Graph

```
apps/web          → @phynd/api, @phynd/config, @phynd/db, @phynd/federation, @phynd/logging, @phynd/services, @phynd/types, @phynd/ui
apps/worker       → @phynd/config, @phynd/db, @phynd/federation, @phynd/logging, @phynd/services, @phynd/types
packages/api      → @phynd/config, @phynd/db, @phynd/services, @phynd/types
packages/services → @phynd/config, @phynd/db, @phynd/types
packages/federation → @phynd/config, @phynd/types
packages/config   → (standalone, Zod validation)
packages/db       → (standalone, Drizzle schema + migrations)
packages/types    → (standalone, shared TypeScript types)
packages/ui       → (standalone, shared UI primitives)
packages/logging  → (standalone, pino structured logging)
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript checks (all 10 packages) |
| `pnpm lint` | Biome lint + format check |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright E2E tests |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run migrations |
| `pnpm db:seed` | Seed database |

## Code Style

- **Linter/Formatter**: Biome (not ESLint/Prettier)
- **Imports**: Alphabetical sorting within member lists (enforced by Biome)
- **No `.js` extensions** in relative imports
- **Optional chaining** (`?.`) over non-null assertion (`!.`)
- **Decorative SVGs**: Must have `aria-hidden="true"`
- **Generated files**: Drizzle migration files (`**/migrations/**`) are excluded from Biome checks
- **File size limits**: Source files should stay under 600 lines (soft warning); pre-commit hook blocks files over 800 lines. Test files, migrations, and generated files are excluded from the check.

## Pre-commit Hooks

husky runs a pre-commit hook (`.husky/pre-commit`) that checks staged `.ts`/`.tsx` files:
- **Warning** at 600 lines (soft limit — commit proceeds)
- **Error** at 800 lines (commit blocked — split the file)
- **Excluded**: test files (`__tests__`, `.test.`, `.spec.`), migrations, `.d.ts`, `.gen.ts`

Hooks auto-install via `pnpm install` (`prepare` script).

## Testing

### Service Tests
- Located in `packages/services/src/__tests__/`
- Use mock query builder from `helpers.ts` (`createTestContext()`, `createMockDb()`)
- Factory helpers: `makeLead()`, `makeOpportunity()`, `makeNote()`, `makeTag()`, `makeUser()`, `makeActivity()`, `makeStageTransition()`, `makeNotification()`, `makeOffer()`, `makeCampaign()`, `makeConversion()`, `makeScoringRule()`, `makePipeline()`, `makePipelineStage()`, `makeVisitorSession()`, `makePageView()`, `makePreference()`, `makeQuote()`, `makeOrder()`
- Large test files should be split by concern (e.g. `analytics-core.service.test.ts` + `analytics-trends.service.test.ts`, `lead-scoring-evaluation.test.ts` + `lead-scoring-crud.test.ts`)
- Every new service must have a corresponding test file

### Router Tests
- Located in `packages/api/src/__tests__/`
- Use `createCallerFactory(appRouter)` to create type-safe callers
- Include `onConflictDoNothing`/`onConflictDoUpdate` in mock query builder when testing upsert operations
- Admin-gated routers (e.g. `users`) must test FORBIDDEN for non-admin roles

### E2E Tests
- Located in `apps/web/e2e/`
- Use Playwright with `test.fixme` for tests requiring auth/DB setup
- New UI features should include E2E test specs

## PR Guidelines

1. Branch from `main` with descriptive name (`feature/`, `fix/`, `chore/`)
2. All 10 packages must typecheck clean: `pnpm typecheck`
3. Lint must pass: `pnpm lint`
4. Build must succeed: `pnpm build`
5. Existing tests must pass: `pnpm test`
6. Add service tests for new service logic
7. Add router tests for new tRPC routers
8. Add E2E test specs for new UI features
9. Update `CLAUDE.md` if adding new patterns, schemas, or routers

## tRPC Routers (24 total)

`activities`, `analytics`, `campaigns`, `contacts`, `conversions`, `federationHealth`, `leadScoring`, `leads`, `notes`, `notifications`, `offers`, `opportunities`, `orders`, `pipelines`, `preferences`, `quotes`, `search`, `tags`, `timeline`, `unifiedProfile`, `users`, `visitorTracking`

Admin-gated routers use `requireRole('admin')` middleware (e.g. `users`).

### Notification Triggers
When a service modifies an entity's `ownerId`, it creates a notification for the new owner using `NotificationsService.create()`. This is non-blocking (wrapped in try/catch) to avoid breaking the primary operation if notification fails.

### Timeline Service
`TimelineService.getTimeline()` aggregates three data sources (activities, stage_transitions, notes) filtered by entityType/entityId, maps each to a `TimelineEntry`, and sorts by timestamp descending. No new DB tables — it reads from existing tables.

### Owner-Scoped Queries
Services accept optional `filters?: { ownerId?: string }` parameter. Router `listMine` procedures auto-scope to `ctx.auth.userId`. Frontend uses `enabled` flag on tRPC queries to conditionally fetch "My Deals" vs "All Deals".

### Feature Flag Enforcement
Feature-gated routers (`leadScoring`, `visitorTracking`, `analytics`, `offers`, `campaigns`) check `isFeatureEnabled()` at the top of each procedure body. When disabled, they throw `TRPCError({ code: 'PRECONDITION_FAILED' })`. All flags default to `true`, so existing tests pass unchanged. When adding tests for gated routers, mock `@phynd/config/features` with `isFeatureEnabled` returning `true`.

### Pipeline Management
Pipelines and stages support full CRUD via `PipelinesService` methods (`create`, `update`, `delete`, `createStage`, `updateStage`, `deleteStage`, `reorderStages`). Pipeline delete rejects if `isDefault` (`ValidationError`) or if leads/opportunities reference it (`ConflictError`). Stage delete similarly checks for FK references. Reorder uses a transaction to update all positions atomically. The settings UI at `/settings/pipelines` uses `@hello-pangea/dnd` for drag-to-reorder stages.

### Time-Series Analytics
`AnalyticsService` provides 4 trend methods (`getLeadTrend`, `getOpportunityTrend`, `getConversionTrend`, `getVisitorTrend`) that accept a required date range and bucket (`day`/`week`/`month`). They use `date_trunc()` + GROUP BY for time bucketing. All require bounded date ranges (no unbounded table scans).

### CSV Import
Contacts support bulk import via `bulkCreate()` (max 500 per call). The CSV parser (`apps/web/src/lib/csv-import.ts`) handles RFC 4180 basics (quoted commas, escaped quotes, BOM). Known limitation: multi-line quoted fields are supported but complex encodings beyond UTF-8 are not.

### Task Reminders
A repeatable BullMQ job (`task-reminders`) scans every 4 hours for activities due within 24 hours and creates notifications. See ADR-006 for design rationale. Deduplication prevents notification spam (checks for existing `task_reminder` notification per activity within 24h).

### Quotes & Orders (Post-Opportunity Lifecycle)
CRM-native quotes and orders bridge opportunities to Cotiza/PravaraMES federation data. Both entities follow the opportunities pattern: soft deletes, owner notifications, cursor pagination, owner-scoped `listMine`.

**Key behavior**: When an order's status changes to `fulfilled` and it has a linked `opportunityId`, the service auto-marks the opportunity as `won` and records an `opportunity_to_won` conversion. This uses a non-blocking try/catch pattern (same as owner assignment notifications).

**EntityType extension**: `EntityType` now includes `'quote' | 'order'`. Timeline, notes, tags, and activities all work with these entities — DB columns are varchar, not enum. When adding new entity types in the future, update the Zod enum in tags, notes, activities, and timeline routers.

### Bulk Operation Caps
`bulkUpdateStatus` on leads/opportunities is capped at 100 items via Zod `.max(100)`. Router tests verify both the happy path (<=100 ids) and the rejection (>100 ids).

### Delete Confirmations
All delete operations in the UI use confirmation dialogs (not direct inline mutations). Pattern: `[deleteEntity, setDeleteEntity] = useState<Row | null>(null)` state drives a `<DeleteEntityDialog>` component. Follow `delete-activity-dialog.tsx` as the canonical pattern.

### Rate Limiting
tRPC API requests are rate-limited at 200 req/min per IP via Redis sliding window (`apps/web/src/lib/rate-limiter.ts`). Webhooks have a separate limit at 100 req/min (`apps/web/src/lib/webhooks/rate-limiter.ts`). Both fail open if Redis is unavailable.

### Security Headers
Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`) are set via `next.config.ts` `headers()`. No CSP yet (shadcn/recharts inline styles need audit).

### Demo Mode

Visitors can try the full CRM via `/demo` without signing up. Architecture:

1. **Entry**: `GET /demo` → generates UUID session, sets `phynd-demo` cookie (httpOnly, 4h), seeds demo tenant, redirects to `/overview`
2. **Isolation**: Each demo session gets `tenantId = demo-{sessionId}`. All seeded entity IDs are prefixed with the session ID. Demo writes only affect the demo sandbox.
3. **Auth injection**: Middleware allows demo cookie holders through without real auth. Both `getServerCaller()` and the tRPC route handler check for the demo cookie and inject `createDemoAuth(sessionId)` as auth context.
4. **Seed data**: ~62 rows per session covering all 14 dashboard pages: user, pipeline, 6 stages, 4 contacts, 3 leads, 3 opps, 2 quotes, 2 orders, 2 offers, 2 campaigns, 4 conversions, 3 visitor sessions, 4 page views, 5 scoring rules, 3 external references, 4 stage transitions, 4 activities, 2 notes, 3 tags, 1 notification. Leads/opps/quotes/orders are backdated across 25 days for analytics trends.
5. **UX**: DemoBanner component (gradient bar with Sign Up / Exit Demo). DEMO badge in sidebar. Header shows "Demo Visitor" instead of user email.
6. **Cleanup**: `demo-cleanup` BullMQ processor runs hourly, deletes all 20 entity types older than 4h in 5-phase dependency order within a transaction (leaf entities → referencing entities → core entities → campaigns/offers → pipeline/user).
7. **Exit**: `GET /demo/exit` clears cookie and redirects to `/`.

To test demo mode locally: navigate to `http://localhost:3000/demo`.

### Demo Federation Data
Demo tenants (tenantId starting with `demo-`) bypass real federation providers. `UnifiedProfileService` detects demo tenants and returns mock data from `demo-federation-data.ts` — realistic provider responses for Janua identity, Dhanam billing, Cotiza orders, PravaraMES fabrication, and Forj 3D assets.

### Seed Architecture
The database seed script (`packages/db/src/seed.ts`) is a thin entry point (prod guard + import). The 13 sub-seeders live in `packages/db/src/seed/` with a shared `SeedIds` interface in `types.ts` and an orchestrator in `index.ts`. Similarly, `apps/web/src/lib/demo-seed.ts` is a transaction orchestrator (~80 lines) importing pure data builder functions from `demo-seed/data-builders.ts`.

## Architecture Decisions

See `docs/adr/` for Architecture Decision Records:
- ADR-001: Federation over ETL
- ADR-002: tRPC over GraphQL
- ADR-003: Single-tenant first
- ADR-004: Circuit breaker pattern
- ADR-005: Rate limiting strategy
- ADR-006: Task reminders strategy
- ADR-007: Demo mode strategy

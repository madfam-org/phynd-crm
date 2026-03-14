# Contributing to Phyne CRM

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker (for Postgres + Redis)

## Setup

```bash
git clone <repo-url>
cd phyne-crm
pnpm install
docker compose -f docker/docker-compose.yml up -d
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Package Graph

```
apps/web          → @phyne/api, @phyne/config, @phyne/db, @phyne/federation, @phyne/logging, @phyne/services, @phyne/types, @phyne/ui
apps/worker       → @phyne/config, @phyne/db, @phyne/federation, @phyne/logging, @phyne/services, @phyne/types
packages/api      → @phyne/config, @phyne/db, @phyne/services, @phyne/types
packages/services → @phyne/config, @phyne/db, @phyne/types
packages/federation → @phyne/config, @phyne/types
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

## Testing

### Service Tests
- Located in `packages/services/src/__tests__/`
- Use mock query builder from `helpers.ts` (`createTestContext()`, `createMockDb()`)
- Factory helpers: `makeLead()`, `makeOpportunity()`, `makeNote()`, `makeTag()`, `makeUser()`, `makeActivity()`, `makeStageTransition()`, `makeNotification()`, etc.
- Every new service must have a corresponding test file

### Router Tests
- Located in `packages/api/src/__tests__/`
- Use `createCallerFactory(appRouter)` to create type-safe callers
- Include `onConflictDoNothing` in mock query builder when testing upsert operations
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

## tRPC Routers (20 total)

`activities`, `analytics`, `campaigns`, `contacts`, `conversions`, `federationHealth`, `leadScoring`, `leads`, `notes`, `notifications`, `offers`, `opportunities`, `pipelines`, `preferences`, `search`, `tags`, `timeline`, `unifiedProfile`, `users`, `visitorTracking`

Admin-gated routers use `requireRole('admin')` middleware (e.g. `users`).

### Notification Triggers
When a service modifies an entity's `ownerId`, it creates a notification for the new owner using `NotificationsService.create()`. This is non-blocking (wrapped in try/catch) to avoid breaking the primary operation if notification fails.

### Timeline Service
`TimelineService.getTimeline()` aggregates three data sources (activities, stage_transitions, notes) filtered by entityType/entityId, maps each to a `TimelineEntry`, and sorts by timestamp descending. No new DB tables — it reads from existing tables.

### Owner-Scoped Queries
Services accept optional `filters?: { ownerId?: string }` parameter. Router `listMine` procedures auto-scope to `ctx.auth.userId`. Frontend uses `enabled` flag on tRPC queries to conditionally fetch "My Deals" vs "All Deals".

## Architecture Decisions

See `docs/adr/` for Architecture Decision Records.

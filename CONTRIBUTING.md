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
packages/db       → (standalone, Drizzle schema)
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

## PR Guidelines

1. Branch from `main` with descriptive name (`feature/`, `fix/`, `chore/`)
2. All 10 packages must typecheck clean: `pnpm typecheck`
3. Lint must pass: `pnpm lint`
4. Build must succeed: `pnpm build`
5. Existing tests must pass: `pnpm test`
6. Add tests for new service logic
7. Update `CLAUDE.md` if adding new patterns, schemas, or routers

## Architecture Decisions

See `docs/adr/` for Architecture Decision Records.

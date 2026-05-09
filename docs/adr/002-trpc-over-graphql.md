# ADR-002: tRPC Over GraphQL for MVP

## Status
Accepted

## Context
The CRM needs a typed API layer between the Next.js frontend and the service layer. The two main contenders:

1. **GraphQL**: Industry standard for federated data, strong ecosystem
2. **tRPC**: End-to-end TypeScript type safety with zero codegen

## Decision
Use **tRPC v11** for the MVP (Phase 1-2). The service layer is kept transport-agnostic to allow migration to GraphQL federation in Phase 3.

## Rationale
- **Zero codegen**: Types flow from service → router → client automatically. No schema-first workflow, no code generation step.
- **Faster iteration**: Adding a new endpoint is a single file with input/output types inferred from Zod schemas.
- **Monorepo fit**: tRPC works natively with TypeScript project references. The `@phynd/api` package exports `AppRouter` type used directly by `apps/web`.
- **Cursor-based pagination**: `PaginationInput { cursor?, limit? }` → `PaginatedResult<T> { items, nextCursor, hasMore }` is trivial with tRPC.
- **MVP velocity**: We need to ship 12+ routers quickly. tRPC's DX advantage is significant for a small team.

## Consequences
- **No public API**: tRPC is TypeScript-only. External consumers need a REST/GraphQL gateway (Phase 3).
- **No query federation**: Can't compose queries across services like GraphQL. Acceptable for single-service MVP.
- **Migration path**: Services accept `ServiceContext` and return plain objects. Routers are thin wrappers. Migration to GraphQL resolvers requires rewriting routers, not services.

## Implementation
- `packages/api/src/router.ts` — Root `appRouter` merging all sub-routers
- `packages/api/src/routers/*.ts` — One file per domain (contacts, leads, opportunities, etc.)
- `packages/services/src/` — Transport-agnostic service classes accepting `ServiceContext`
- `apps/web/src/lib/trpc/` — Client setup with React Query integration

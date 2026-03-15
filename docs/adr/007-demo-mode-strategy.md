# ADR-007: Demo Mode Strategy

## Status
Accepted

## Context
Visitors to the Phyne landing page can't experience the product without signing up via Janua OIDC — a friction point that blocks conversion. The marketing site shows text and diagrams but no interactive product preview. We need a way for visitors to explore the full CRM without creating an account, while keeping demo data completely isolated from production data.

## Decision
Implement a **cookie-based interactive demo mode** with per-session tenant isolation and automatic cleanup.

### Architecture

#### Entry Flow
- `GET /demo` → generates UUID session ID, sets `phyne-demo={sessionId}` cookie (httpOnly, sameSite=lax, maxAge=4h), seeds demo tenant, redirects to `/overview`
- Middleware allows demo cookie holders through without real auth
- Both `getServerCaller()` and tRPC route handler inject `createDemoAuth(sessionId)` as auth context

#### Per-Session Isolation
- Each visitor gets `tenantId = 'demo-{sessionId}'` and `userId = 'demo-{sessionId}'`
- All seeded entity IDs are prefixed with `demo-{sessionId}` (e.g., `demo-abc123-c1`, `demo-abc123-l1`)
- Demo user gets admin role for full feature visibility
- Demo writes only affect the demo sandbox — no shared state between sessions

#### Demo Seed
- `seedDemoTenant(sessionId)` creates ~25 entities per session in a single transaction
- Entities: 1 user, 1 pipeline, 5 stages, 4 contacts, 3 leads, 3 opportunities, 2 quotes, 2 orders, 4 activities, 2 notes, 3 tags + 3 taggables, 1 notification
- Non-blocking: `seedDemoTenant().catch(() => {})` — dashboard pages handle empty state gracefully

#### Cleanup
- `demo-cleanup` BullMQ processor runs every hour (`0 * * * *`)
- Finds users with `id LIKE 'demo-%'` and `createdAt < now() - 4h`
- Deletes in reverse dependency order within transaction: taggables → tags → notes → notifications → activities → orders → quotes → opportunities → leads → contacts → pipeline_stages → pipelines → users
- Per-tenant try/catch: one tenant's failure doesn't block others

#### Exit
- `GET /demo/exit` → clears cookie, redirects to `/`

### Files
- `apps/web/src/lib/demo.ts` — Constants and helpers
- `apps/web/src/lib/demo-seed.ts` — Seed function
- `apps/web/src/app/demo/route.ts` — Entry route handler
- `apps/web/src/app/demo/exit/route.ts` — Exit route handler
- `apps/web/src/components/demo/demo-banner.tsx` — UI banner
- `apps/worker/src/processors/demo-cleanup.ts` — Cleanup processor

## Rationale

### Why cookie-based (not URL param)?
- httpOnly cookie prevents JS access (XSS-safe)
- SameSite=lax prevents CSRF
- Cookie persists across page navigations without modifying dashboard URLs
- Same dashboard routes serve both real and demo users — no page duplication

### Why per-session isolation (not shared demo tenant)?
- Concurrent visitors don't interfere with each other
- Full read+write access — visitors can create, edit, delete within their sandbox
- No contention or race conditions between demo sessions
- Natural alignment with Phase 3 multi-tenant architecture

### Why 4-hour TTL?
- Long enough for meaningful exploration session
- Short enough to prevent unbounded data growth
- Matches httpOnly cookie maxAge for consistency
- Hourly cleanup means worst-case 5h of stale data

### Why non-blocking seed?
- Visitor sees dashboard immediately (loading states handle empty data)
- Seed failure is non-fatal — better to show empty pages than error
- Transaction ensures atomicity — either all entities are created or none
- Follows existing non-blocking patterns (notification triggers, scoring recompute)

### Why admin role for demo users?
- Demo visitors should see the complete feature set (settings, user management, etc.)
- Restricting features would misrepresent the product
- All demo writes are sandboxed so admin access is safe

### Why no feature flag?
- Demo mode is a product feature, not a deployable toggle
- Always available in all environments
- No risk to production data (per-session isolation)

## Consequences

### Positive
- Zero new dependencies (uses existing BullMQ, Drizzle, cookie infrastructure)
- No page duplication — same dashboard pages serve both modes
- Production-safe: demo tenants are completely isolated
- Prepares the tenant isolation pattern for Phase 3 multi-tenancy

### Negative
- Demo data accumulates between cleanup cycles (bounded by TTL)
- Each demo session adds ~25 rows to the database (cleaned up within 5h)
- No real federation data in demo mode (only CRM entities are seeded)

### Risks
- **High demo volume**: Many concurrent visitors each create ~25 rows. At 1000 concurrent visitors, that's ~25K rows — well within Postgres capacity. Cleanup runs hourly.
- **Cleanup failure**: If the cleanup job fails, stale demo data persists but is harmless (isolated tenant). Next hourly run picks it up.
- **Cookie replay**: A stolen demo cookie only grants access to demo-scoped data with a 4h expiry. No access to real production data.

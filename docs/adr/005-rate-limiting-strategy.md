# ADR-005: Rate Limiting Strategy

## Status
Accepted

## Context
Phynd exposes tRPC endpoints via Next.js API routes and webhook endpoints from 6 external providers. Both surfaces need protection against abuse, but have different runtime constraints and threat models.

## Decision
Implement **Redis sliding-window rate limiting** at the API route level for both tRPC and webhook endpoints, with separate limits and key namespaces.

### tRPC API Rate Limiting
- **Location**: `apps/web/src/app/api/trpc/[trpc]/route.ts` — wraps the `fetchRequestHandler`
- **Implementation**: `apps/web/src/lib/rate-limiter.ts` — `checkApiRateLimit(ip)`
- **Limit**: 200 requests per minute per IP
- **Key prefix**: `phynd:ratelimit:api:{ip}`

### Webhook Rate Limiting
- **Location**: `apps/web/src/lib/webhooks/handler.ts` — shared webhook handler
- **Implementation**: `apps/web/src/lib/webhooks/rate-limiter.ts` — `checkRateLimit(ip)`
- **Limit**: 100 requests per minute per IP
- **Key prefix**: `phynd:ratelimit:webhook:{ip}`

## Rationale

### Why not Edge Middleware?
Next.js Edge Middleware runs in the Edge Runtime, which does not support Node.js-specific modules. Our Redis client (`ioredis`) requires Node.js APIs (TCP sockets, Buffer). Alternatives like `@upstash/redis` exist for Edge, but would add a dependency and force a different Redis client for rate limiting vs. the rest of the application.

### Why Redis sliding window?
- **Distributed**: Works across multiple web server instances (horizontal scaling in Phase 3)
- **Consistent**: Same Redis infrastructure used for caching and BullMQ job queues
- **Simple**: `INCR` + `PEXPIRE` pattern — no external libraries needed
- **Accurate**: Per-key TTL ensures the window slides naturally

### Why fail open?
If Redis is unavailable, rate limiting allows the request through. Rationale:
- Redis downtime should not block legitimate API access
- The circuit breaker pattern already handles federation provider failures
- Webhook HMAC validation provides a separate security layer
- Rate limiting is a defense-in-depth measure, not the sole security control

### Why separate limits?
- **tRPC (200/min)**: Higher limit for interactive dashboard usage — page loads trigger multiple parallel queries
- **Webhooks (100/min)**: Lower limit — webhook payloads are larger and trigger background processing

## Consequences
- **IP spoofing**: Rate limiting relies on `x-forwarded-for`. Behind a trusted reverse proxy (Docker/cloud), this is reliable. Direct exposure would need additional measures.
- **Shared IPs**: Corporate NAT or VPN users may share an IP. The 200/min limit is generous enough to avoid false positives for typical CRM usage.
- **No per-user limiting**: Phase 1 uses per-IP only. Per-user rate limiting (via auth token) can be added in Phase 2 when multi-tenancy increases the risk of abuse.

## Implementation
- `apps/web/src/lib/rate-limiter.ts` — Generic API rate limiter
- `apps/web/src/lib/webhooks/rate-limiter.ts` — Webhook-specific rate limiter
- `apps/web/src/app/api/trpc/[trpc]/route.ts` — Rate limit check before tRPC handler
- Both use the same `ioredis` lazy-init pattern with `maxRetriesPerRequest: 1`

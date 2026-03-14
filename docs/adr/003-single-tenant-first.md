# ADR-003: Single-Tenant First with Multi-Tenant Preparation

## Status
Accepted

## Context
Phyne is designed as a SaaS CRM but needs to ship quickly for a single customer (MADFAM ecosystem). Multi-tenancy adds complexity to every layer: auth, data isolation, caching, billing.

## Decision
Phase 1-2: **Single tenant** with `tenantId` hardcoded to `'madfam'` throughout the codebase. Phase 3: Multi-tenant SaaS with tenant extracted from JWT.

## Rationale
- **Ship faster**: Skip tenant isolation, row-level security, tenant provisioning, and billing integration in MVP.
- **Preparation built-in**: `tenantId` appears in `ServiceContext` and Redis cache keys (`phyne:{tenantId}:fed:{provider}:{id}`) from day 1. Migration to multi-tenant requires changing the source of `tenantId`, not adding it.
- **Risk reduction**: Multi-tenant bugs (data leaks, cross-tenant queries) are catastrophic. Better to add tenant isolation deliberately after the data model stabilizes.

## Consequences
- **No tenant switching**: Single deployment serves one customer until Phase 3.
- **Cache key ready**: Redis keys already namespace by tenant. No cache migration needed.
- **Auth placeholder**: `AUTH_BYPASS=true` available in development (blocked in production via Zod superRefine). Janua OIDC provides real auth.
- **Schema ready**: No `tenant_id` column needed yet — will add with RLS policies in Phase 3.

## Implementation
- `packages/services/src/context.ts` — `ServiceContext.tenantId` set to `'madfam'`
- `packages/federation/src/core/cache-manager.ts` — Keys prefixed with `phyne:{tenantId}:fed:`
- `packages/config/src/env.ts` — `AUTH_BYPASS` blocked in production

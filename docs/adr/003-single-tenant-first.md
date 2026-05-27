# ADR-003: Single-Tenant First with Multi-Tenant Preparation

## Status
Accepted; amended by implementation reality on 2026-05-27

## 2026-05-27 Update

The original single-tenant-first decision still explains the initial design, but
current service context creation is no longer a hardcoded-only path. Tenant ID
resolution now accepts an explicit argument, then `auth.tenantId`, then
`DEFAULT_TENANT_ID`, which defaults to `madfam`. The `multiTenancy` feature flag
is also enabled by default. Full tenant-isolation hardening remains a separate
production-readiness concern.

## Context
Phynd is designed as a SaaS CRM but needs to ship quickly for a single customer (MADFAM ecosystem). Multi-tenancy adds complexity to every layer: auth, data isolation, caching, billing.

## Decision
Phase 1-2 started as **single tenant** with `tenantId` defaulting to `'madfam'`
throughout the codebase. Current code keeps `madfam` as the fallback while
allowing explicit/auth-derived tenant IDs.

## Rationale
- **Ship faster**: Skip tenant isolation, row-level security, tenant provisioning, and billing integration in MVP.
- **Preparation built-in**: `tenantId` appears in `ServiceContext` and Redis cache keys (`phynd:{tenantId}:fed:{provider}:{id}`) from day 1. Migration to multi-tenant requires changing the source of `tenantId`, not adding it.
- **Risk reduction**: Multi-tenant bugs (data leaks, cross-tenant queries) are catastrophic. Better to add tenant isolation deliberately after the data model stabilizes.

## Consequences
- **No tenant switching**: Single deployment serves one customer until Phase 3.
- **Cache key ready**: Redis keys already namespace by tenant. No cache migration needed.
- **Auth placeholder**: `AUTH_BYPASS=true` available in development (blocked in production via Zod superRefine). Janua OIDC provides real auth.
- **Schema ready**: No `tenant_id` column needed yet — will add with RLS policies in Phase 3.

## Implementation
- `packages/services/src/context.ts` — `ServiceContext.tenantId` set to `'madfam'`
- `packages/federation/src/core/cache-manager.ts` — Keys prefixed with `phynd:{tenantId}:fed:`
- `packages/config/src/env.ts` — `AUTH_BYPASS` blocked in production

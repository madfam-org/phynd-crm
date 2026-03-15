# ADR-001: Data Virtualization (Federation) Over ETL

## Status
Accepted

## Context
Phyne CRM needs to aggregate data from 6 MADFAM ecosystem platforms (Janua, Dhanam, Cotiza, PravaraMES, Forj, Janua Telemetry). The fundamental choice is between:

1. **ETL/Replication**: Copy data into the CRM database, keep it synced
2. **Data Virtualization**: Query source systems on-demand, cache locally

## Decision
We chose **data virtualization** (federation) — querying upstream providers at read time with Redis caching rather than replicating data.

## Rationale
- **No data duplication**: Upstream systems remain the single source of truth. Eliminates sync drift, stale data, and consistency bugs.
- **Reduced storage**: CRM only stores CRM-specific data (contacts, leads, opportunities, quotes, orders, notes). Provider data lives in provider databases.
- **Compliance**: No PII duplication across systems. GDPR "right to be forgotten" is handled at the source.
- **Partial failure tolerance**: `Promise.allSettled()` allows the SPOG to render even when some providers are down.
- **Simpler operations**: No ETL pipelines to monitor, no sync jobs to debug, no conflict resolution logic.

## Consequences
- **Latency**: First load depends on upstream provider response times. Mitigated by Redis caching (TTL varies by provider: 45s-60s).
- **Availability coupling**: If a provider is down and cache is cold, that panel shows "unavailable". Circuit breakers prevent cascade failures.
- **No offline queries**: Cannot run analytics on provider data without cache. Phase 2 may add selective denormalization for analytics.
- **Write path complexity**: Phase 2 bidirectional sync will need conflict resolution that ETL would have solved upfront.

## Implementation
- `packages/federation/` — Provider abstraction, cache manager, circuit breaker, retry
- 6 providers implementing `FederationProvider<TRaw, TMapped>` interface
- `FederationClient` wraps each provider with caching, retry, and circuit breaking
- Config-driven timeouts via `AbortSignal.timeout()` propagated to providers

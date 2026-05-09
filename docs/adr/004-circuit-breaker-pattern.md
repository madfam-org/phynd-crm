# ADR-004: Circuit Breaker Pattern for Federation Resilience

## Status
Accepted

## Context
Phynd federates data from 6 external providers. Any provider can become slow or unavailable. Without protection, a single slow provider can cascade into full page timeouts.

## Decision
Implement the **circuit breaker pattern** for all federation provider calls, with shared circuit breaker instances between `FederationClient` and `ProviderHealthChecker`.

## Rationale
- **Cascade prevention**: When a provider is unhealthy, the circuit breaker opens and fails fast instead of waiting for timeouts.
- **Self-healing**: Half-open state automatically probes the provider after a cooldown period, recovering without manual intervention.
- **Partial degradation**: With `Promise.allSettled()`, an open circuit on one provider still allows the SPOG to render data from the other 5.
- **Shared state**: Circuit breaker instances are shared between `FederationClient` and `ProviderHealthChecker` via constructor injection, so health probes and data fetches contribute to the same circuit state.

## Configuration
| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Failure threshold | 5 consecutive failures | Enough to distinguish transient from sustained failure |
| Reset timeout | 30 seconds | Cooldown in OPEN state before probing via HALF_OPEN |
| Success threshold | 3 consecutive successes | Required in HALF_OPEN to return to CLOSED |

Note: The implementation uses a simple failure counter (not a rolling time window). Any successful call in CLOSED state resets the failure count to zero, so transient failures self-heal.

## States
```
CLOSED → (5 failures) → OPEN → (30s cooldown) → HALF_OPEN → (3 successes) → CLOSED
                                                   ↓ (1 failure)
                                                  OPEN
```

## Consequences
- **False positives**: Transient network glitches may open the circuit. Mitigated by the 5-failure threshold and success-resets-counter behavior.
- **Recovery lag**: 30s open duration means a provider that recovers instantly still has up to 30s of failed fast responses. Acceptable for a CRM dashboard.
- **Memory**: Each circuit breaker maintains a sliding window of failure timestamps. Negligible memory overhead.

## Implementation
- `packages/federation/src/core/circuit-breaker.ts` — `CircuitBreaker` class with CLOSED/OPEN/HALF_OPEN states
- `packages/federation/src/core/federation-client.ts` — Constructor accepts optional `CircuitBreaker` injection
- `apps/web/src/lib/federation/clients.ts` — `getCircuitBreakers()` creates shared instances passed to both clients and health checker
- `apps/worker/src/lib/federation.ts` — Same shared CB pattern for worker process
- Config-driven timeouts: `ProviderConfig.timeout` → `AbortSignal.timeout()` propagated to provider `fetch()` calls

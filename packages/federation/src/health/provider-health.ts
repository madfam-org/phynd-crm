import type { FederationHealthStatus, FederationProviderName, ProviderStatus } from '@phyne/types/federation'
import type { CircuitBreaker } from '../core/circuit-breaker'

interface HealthProbeConfig {
  provider: FederationProviderName
  baseUrl: string
  circuitBreaker: CircuitBreaker
}

export class ProviderHealthChecker {
  private readonly probes: HealthProbeConfig[]

  constructor(probes: HealthProbeConfig[]) {
    this.probes = probes
  }

  async checkAll(): Promise<FederationHealthStatus[]> {
    return Promise.all(this.probes.map((probe) => this.check(probe)))
  }

  async check(probe: HealthProbeConfig): Promise<FederationHealthStatus> {
    const start = Date.now()
    let status: ProviderStatus = 'unavailable'
    let latencyMs: number | null = null

    try {
      const response = await fetch(`${probe.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      latencyMs = Date.now() - start

      if (response.ok) {
        status = 'ok'
      } else {
        status = 'degraded'
      }
    } catch {
      latencyMs = Date.now() - start
      status = 'unavailable'
    }

    return {
      provider: probe.provider,
      status,
      latencyMs,
      lastChecked: new Date(),
      circuitState: probe.circuitBreaker.getState(),
    }
  }
}

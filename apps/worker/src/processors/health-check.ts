import type { Job } from 'bullmq'
import { getHealthChecker } from '../lib/federation'

interface HealthCheckData {
  providers: string[]
}

export async function processHealthCheck(_job: Job<HealthCheckData>): Promise<void> {
  console.log('[health-check] Running provider health checks')

  const checker = getHealthChecker()
  const results = await checker.checkAll()

  for (const result of results) {
    console.log(
      `  ${result.provider}: ${result.status} (${result.latencyMs ?? '?'}ms, circuit: ${result.circuitState})`,
    )
  }

  // Health snapshots are persisted via the analytics service when the DB is connected.
  // In the worker context, we log the results for now; the health-snapshot table
  // is populated by the API-side analytics when DB access is available.
}

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
}

import { getDb } from '@phyne/db'
import { healthSnapshots } from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
import type { Job } from 'bullmq'
import { getHealthChecker } from '../lib/federation'

const logger = createLogger('worker:health-check')

interface HealthCheckData {
  providers: string[]
}

export async function processHealthCheck(_job: Job<HealthCheckData>): Promise<void> {
  logger.info('Running provider health checks')

  const checker = getHealthChecker()
  const results = await checker.checkAll()

  for (const result of results) {
    logger.info(
      {
        provider: result.provider,
        status: result.status,
        latencyMs: result.latencyMs,
        circuitState: result.circuitState,
      },
      `${result.provider}: ${result.status} (${result.latencyMs ?? '?'}ms, circuit: ${result.circuitState})`,
    )
  }

  const db = getDb()
  await db.insert(healthSnapshots).values(
    results.map((r) => ({
      provider: r.provider,
      status: r.status,
      latencyMs: r.latencyMs,
      circuitState: r.circuitState,
      checkedAt: r.lastChecked,
    })),
  )

  logger.info({ count: results.length }, `Persisted ${results.length} health snapshots`)
}

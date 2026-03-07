import { Worker } from 'bullmq'
import { processCacheWarmup } from './processors/cache-warmup'
import { processFederationSync } from './processors/federation-sync'
import { processHealthCheck } from './processors/health-check'
import { processLeadScoring } from './processors/lead-scoring'
import { processSessionIdentify } from './processors/session-identify'
import { createRedisConnection } from './queues'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

async function main() {
  const connection = createRedisConnection(REDIS_URL)

  const federationWorker = new Worker('federation-sync', processFederationSync, {
    connection,
    concurrency: 5,
  })

  const cacheWorker = new Worker('cache-warmup', processCacheWarmup, {
    connection,
    concurrency: 2,
  })

  const healthWorker = new Worker('health-check', processHealthCheck, {
    connection,
    concurrency: 1,
  })

  const sessionIdentifyWorker = new Worker('session-identify', processSessionIdentify, {
    connection,
    concurrency: 3,
  })

  const leadScoringWorker = new Worker('lead-scoring', processLeadScoring, {
    connection,
    concurrency: 1,
  })

  console.log('Workers started:')
  console.log('  - federation-sync (concurrency: 5)')
  console.log('  - cache-warmup (concurrency: 2)')
  console.log('  - health-check (concurrency: 1)')
  console.log('  - session-identify (concurrency: 3)')
  console.log('  - lead-scoring (concurrency: 1)')

  const shutdown = async () => {
    console.log('Shutting down workers...')
    await Promise.all([
      federationWorker.close(),
      cacheWorker.close(),
      healthWorker.close(),
      sessionIdentifyWorker.close(),
      leadScoringWorker.close(),
    ])
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('Worker startup failed:', err)
  process.exit(1)
})

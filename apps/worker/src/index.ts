import { Worker } from 'bullmq'
import { createRedisConnection } from './queues'
import { processFederationSync } from './processors/federation-sync'
import { processCacheWarmup } from './processors/cache-warmup'
import { processHealthCheck } from './processors/health-check'

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

  console.log('Workers started:')
  console.log('  - federation-sync (concurrency: 5)')
  console.log('  - cache-warmup (concurrency: 2)')
  console.log('  - health-check (concurrency: 1)')

  const shutdown = async () => {
    console.log('Shutting down workers...')
    await Promise.all([
      federationWorker.close(),
      cacheWorker.close(),
      healthWorker.close(),
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

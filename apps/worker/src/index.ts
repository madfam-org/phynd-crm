import { createLogger } from '@phyne/logging'
import { Worker } from 'bullmq'
import { processCacheWarmup } from './processors/cache-warmup'
import { processFederationSync } from './processors/federation-sync'
import { processHealthCheck } from './processors/health-check'
import { processLeadScoring } from './processors/lead-scoring'
import { processSessionIdentify } from './processors/session-identify'
import { createRedisConnection } from './queues'

const logger = createLogger('worker:main')

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

async function main() {
  const connection = createRedisConnection(REDIS_URL)

  const federationWorker = new Worker('federation-sync', processFederationSync, {
    connection,
    concurrency: 5,
    maxStalledCount: 2,
  })

  const cacheWorker = new Worker('cache-warmup', processCacheWarmup, {
    connection,
    concurrency: 2,
    maxStalledCount: 2,
  })

  const healthWorker = new Worker('health-check', processHealthCheck, {
    connection,
    concurrency: 1,
    maxStalledCount: 2,
  })

  const sessionIdentifyWorker = new Worker('session-identify', processSessionIdentify, {
    connection,
    concurrency: 3,
    maxStalledCount: 2,
  })

  const leadScoringWorker = new Worker('lead-scoring', processLeadScoring, {
    connection,
    concurrency: 1,
    maxStalledCount: 2,
  })

  const workers = [
    { name: 'federation-sync', worker: federationWorker },
    { name: 'cache-warmup', worker: cacheWorker },
    { name: 'health-check', worker: healthWorker },
    { name: 'session-identify', worker: sessionIdentifyWorker },
    { name: 'lead-scoring', worker: leadScoringWorker },
  ]

  for (const { name, worker } of workers) {
    worker.on('completed', (job) => {
      logger.info({ worker: name, jobId: job.id }, `Job ${job.id} completed`)
    })
    worker.on('failed', (job, err) => {
      logger.error({ worker: name, jobId: job?.id, err: err.message }, `Job ${job?.id} failed`)
    })
    worker.on('stalled', (jobId) => {
      logger.warn({ worker: name, jobId }, `Job ${jobId} stalled`)
    })
  }

  logger.info(
    {
      workers: [
        { name: 'federation-sync', concurrency: 5 },
        { name: 'cache-warmup', concurrency: 2 },
        { name: 'health-check', concurrency: 1 },
        { name: 'session-identify', concurrency: 3 },
        { name: 'lead-scoring', concurrency: 1 },
      ],
    },
    'Workers started',
  )

  const shutdown = async () => {
    logger.info('Shutting down workers...')
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
  logger.error({ err }, 'Worker startup failed')
  process.exit(1)
})

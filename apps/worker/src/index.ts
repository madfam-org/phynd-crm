import { createLogger } from '@phyne/logging'
import { Worker } from 'bullmq'
import { processCacheWarmup } from './processors/cache-warmup'
import { processDemoCleanup } from './processors/demo-cleanup'
import { processFederationSync } from './processors/federation-sync'
import { processGrantComplianceCheck } from './processors/grant-compliance-check'
import { processHealthCheck } from './processors/health-check'
import { processLeadScoring } from './processors/lead-scoring'
import { processSessionIdentify } from './processors/session-identify'
import { processTaskReminders } from './processors/task-reminders'
import { createQueues, createRedisConnection } from './queues'

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

  const taskRemindersWorker = new Worker('task-reminders', processTaskReminders, {
    connection,
    concurrency: 1,
    maxStalledCount: 2,
  })

  const grantComplianceCheckWorker = new Worker(
    'grant-compliance-check',
    processGrantComplianceCheck,
    {
      connection,
      concurrency: 2,
      maxStalledCount: 2,
    },
  )

  const demoCleanupWorker = new Worker('demo-cleanup', processDemoCleanup, {
    connection,
    concurrency: 1,
    maxStalledCount: 2,
  })

  // Schedule repeatable jobs
  const queues = createQueues(connection)
  await queues.taskReminders.add('check-due-tasks', {}, { repeat: { pattern: '0 */4 * * *' } })
  await queues.demoCleanup.add('cleanup-expired-demos', {}, { repeat: { pattern: '0 * * * *' } })

  const workers = [
    { name: 'cache-warmup', worker: cacheWorker },
    { name: 'demo-cleanup', worker: demoCleanupWorker },
    { name: 'federation-sync', worker: federationWorker },
    { name: 'grant-compliance-check', worker: grantComplianceCheckWorker },
    { name: 'health-check', worker: healthWorker },
    { name: 'lead-scoring', worker: leadScoringWorker },
    { name: 'session-identify', worker: sessionIdentifyWorker },
    { name: 'task-reminders', worker: taskRemindersWorker },
  ]

  for (const { name, worker } of workers) {
    worker.on('completed', (job) => {
      logger.info({ jobId: job.id, worker: name }, `Job ${job.id} completed`)
    })
    worker.on('failed', (job, err) => {
      logger.error({ err: err.message, jobId: job?.id, worker: name }, `Job ${job?.id} failed`)
    })
    worker.on('stalled', (jobId) => {
      logger.warn({ jobId, worker: name }, `Job ${jobId} stalled`)
    })
  }

  logger.info(
    {
      workers: [
        { concurrency: 2, name: 'cache-warmup' },
        { concurrency: 1, name: 'demo-cleanup' },
        { concurrency: 5, name: 'federation-sync' },
        { concurrency: 2, name: 'grant-compliance-check' },
        { concurrency: 1, name: 'health-check' },
        { concurrency: 1, name: 'lead-scoring' },
        { concurrency: 3, name: 'session-identify' },
        { concurrency: 1, name: 'task-reminders' },
      ],
    },
    'Workers started',
  )

  const shutdown = async () => {
    logger.info('Shutting down workers...')
    await Promise.all([
      cacheWorker.close(),
      demoCleanupWorker.close(),
      federationWorker.close(),
      grantComplianceCheckWorker.close(),
      healthWorker.close(),
      leadScoringWorker.close(),
      sessionIdentifyWorker.close(),
      taskRemindersWorker.close(),
      queues.demoCleanup.close(),
      queues.grantComplianceCheck.close(),
      queues.taskReminders.close(),
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

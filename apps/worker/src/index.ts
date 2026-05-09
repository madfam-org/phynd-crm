import * as Sentry from '@sentry/node'

const sentryDsn = process.env.SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  })
}

import http from 'node:http'
import { createLogger } from '@phynd/logging'
import { Worker } from 'bullmq'
import { processCacheWarmup } from './processors/cache-warmup'
import { processDemoCleanup } from './processors/demo-cleanup'
import { processEmailDrip } from './processors/email-drip'
import { processFederationSync } from './processors/federation-sync'
import { processGrantComplianceCheck } from './processors/grant-compliance-check'
import { processHealthCheck } from './processors/health-check'
import { processLeadScoring } from './processors/lead-scoring'
import { processProductionDispatch } from './processors/production-dispatch'
import { processRedditBot } from './processors/reddit-bot'
import { processReferralRewardDispatch } from './processors/referral-reward-dispatch'
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

  const emailDripWorker = new Worker('email-drip', processEmailDrip, {
    connection,
    concurrency: 2,
    maxStalledCount: 2,
  })

  const referralRewardDispatchWorker = new Worker(
    'referral-reward-dispatch',
    processReferralRewardDispatch,
    {
      connection,
      concurrency: 2,
      maxStalledCount: 2,
    },
  )

  const productionDispatchWorker = new Worker('production-dispatch', processProductionDispatch, {
    connection,
    concurrency: 2,
    maxStalledCount: 2,
  })

  const redditBotWorker = new Worker('reddit-bot', processRedditBot, {
    connection,
    concurrency: 1,
    maxStalledCount: 2,
  })

  const demoCleanupWorker = new Worker('demo-cleanup', processDemoCleanup, {
    connection,
    concurrency: 1,
    maxStalledCount: 2,
  })

  // Schedule repeatable jobs
  const queues = createQueues(connection)
  await queues.taskReminders.add('check-due-tasks', {}, { repeat: { pattern: '0 */4 * * *' } })
  await queues.demoCleanup.add('cleanup-expired-demos', {}, { repeat: { pattern: '0 * * * *' } })
  await queues.productionDispatch.add('scan', {}, { repeat: { pattern: '* * * * *' } })

  // Reddit bot: poll every 15 minutes
  const redditSubreddits = (
    process.env.REDDIT_TARGET_SUBREDDITS ?? 'DerechoMexicano,LegalAdviceMexico,mexico'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (process.env.REDDIT_CLIENT_ID) {
    await queues.redditBot.add(
      'poll-subreddits',
      { subreddits: redditSubreddits },
      { repeat: { pattern: '*/15 * * * *' } },
    )
    logger.info({ subreddits: redditSubreddits }, 'Reddit bot polling scheduled (every 15 min)')
  } else {
    logger.info('Reddit bot polling disabled — REDDIT_CLIENT_ID not set')
  }

  const workers = [
    { name: 'cache-warmup', worker: cacheWorker },
    { name: 'demo-cleanup', worker: demoCleanupWorker },
    { name: 'email-drip', worker: emailDripWorker },
    { name: 'federation-sync', worker: federationWorker },
    { name: 'grant-compliance-check', worker: grantComplianceCheckWorker },
    { name: 'health-check', worker: healthWorker },
    { name: 'lead-scoring', worker: leadScoringWorker },
    { name: 'production-dispatch', worker: productionDispatchWorker },
    { name: 'reddit-bot', worker: redditBotWorker },
    { name: 'referral-reward-dispatch', worker: referralRewardDispatchWorker },
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

  // HTTP health check server for Kubernetes/Docker probes
  const HEALTH_PORT = Number.parseInt(process.env.WORKER_HEALTH_PORT ?? '3001', 10)

  const healthServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', service: 'phynd-crm-worker', version: '0.1.0' }))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  })

  healthServer.listen(HEALTH_PORT, () => {
    logger.info({ port: HEALTH_PORT }, 'Worker health server listening')
  })

  logger.info(
    {
      workers: [
        { concurrency: 2, name: 'cache-warmup' },
        { concurrency: 1, name: 'demo-cleanup' },
        { concurrency: 2, name: 'email-drip' },
        { concurrency: 5, name: 'federation-sync' },
        { concurrency: 2, name: 'grant-compliance-check' },
        { concurrency: 1, name: 'health-check' },
        { concurrency: 1, name: 'lead-scoring' },
        { concurrency: 2, name: 'production-dispatch' },
        { concurrency: 1, name: 'reddit-bot' },
        { concurrency: 2, name: 'referral-reward-dispatch' },
        { concurrency: 3, name: 'session-identify' },
        { concurrency: 1, name: 'task-reminders' },
      ],
    },
    'Workers started',
  )

  const shutdown = async () => {
    logger.info('Shutting down workers...')
    healthServer.close()
    await Promise.all([
      cacheWorker.close(),
      demoCleanupWorker.close(),
      emailDripWorker.close(),
      federationWorker.close(),
      grantComplianceCheckWorker.close(),
      healthWorker.close(),
      leadScoringWorker.close(),
      productionDispatchWorker.close(),
      redditBotWorker.close(),
      referralRewardDispatchWorker.close(),
      sessionIdentifyWorker.close(),
      taskRemindersWorker.close(),
      queues.demoCleanup.close(),
      queues.emailDrip.close(),
      queues.grantComplianceCheck.close(),
      queues.productionDispatch.close(),
      queues.redditBot.close(),
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

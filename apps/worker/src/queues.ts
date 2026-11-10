import {
  REFERRAL_REWARD_DISPATCH_JOB_OPTIONS,
  REFERRAL_REWARD_DISPATCH_QUEUE,
} from '@phynd/config/queues'
import type { ConnectionOptions } from 'bullmq'
import { Queue } from 'bullmq'

// ---------------------------------------------------------------------------
// Queue job-retention defaults (shared across queue definitions)
// ---------------------------------------------------------------------------

/** High-throughput queues: federation-sync, session-identify, grants, email, production-dispatch */
const HIGH_THROUGHPUT_RETENTION = {
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
} as const

/** Medium-throughput queues: cache-warmup, lead-scoring, reddit-bot, buyer-signal-push */
const MEDIUM_THROUGHPUT_RETENTION = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
} as const

/** Low-throughput queues: health-check, task-reminders, demo-cleanup */
const LOW_THROUGHPUT_RETENTION = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
} as const

// Backoff delay presets (milliseconds)
const BACKOFF_DELAY_FAST = 1_000
const BACKOFF_DELAY_NORMAL = 2_000
const BACKOFF_DELAY_SLOW = 5_000
const BACKOFF_DELAY_VERY_SLOW = 10_000

export function createRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl)
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
  }
}

export function createQueues(connection: ConnectionOptions) {
  const federationSync = new Queue('federation-sync', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_FAST },
      ...HIGH_THROUGHPUT_RETENTION,
    },
  })

  const cacheWarmup = new Queue('cache-warmup', {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_NORMAL },
      ...MEDIUM_THROUGHPUT_RETENTION,
    },
  })

  const healthCheck = new Queue('health-check', {
    connection,
    defaultJobOptions: {
      attempts: 1,
      ...LOW_THROUGHPUT_RETENTION,
    },
  })

  const sessionIdentify = new Queue('session-identify', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_FAST },
      ...HIGH_THROUGHPUT_RETENTION,
    },
  })

  const leadScoring = new Queue('lead-scoring', {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_NORMAL },
      ...MEDIUM_THROUGHPUT_RETENTION,
    },
  })

  const taskReminders = new Queue('task-reminders', {
    connection,
    defaultJobOptions: {
      attempts: 1,
      ...LOW_THROUGHPUT_RETENTION,
    },
  })

  const demoCleanup = new Queue('demo-cleanup', {
    connection,
    defaultJobOptions: {
      attempts: 1,
      ...LOW_THROUGHPUT_RETENTION,
    },
  })

  const grantComplianceCheck = new Queue('grant-compliance-check', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_NORMAL },
      ...HIGH_THROUGHPUT_RETENTION,
    },
  })

  const emailDrip = new Queue('email-drip', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_SLOW },
      ...HIGH_THROUGHPUT_RETENTION,
    },
  })

  // Shared with the producer (apps/web referrals/convert): a job's options
  // come from the add() that created it, so both sides use one definition.
  const referralRewardDispatch = new Queue(REFERRAL_REWARD_DISPATCH_QUEUE, {
    connection,
    defaultJobOptions: REFERRAL_REWARD_DISPATCH_JOB_OPTIONS,
  })

  const productionDispatch = new Queue('production-dispatch', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_SLOW },
      ...HIGH_THROUGHPUT_RETENTION,
    },
  })

  const redditBot = new Queue('reddit-bot', {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_VERY_SLOW },
      ...MEDIUM_THROUGHPUT_RETENTION,
    },
  })

  const buyerSignalPush = new Queue('buyer-signal-push', {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: BACKOFF_DELAY_VERY_SLOW },
      ...MEDIUM_THROUGHPUT_RETENTION,
    },
  })

  return {
    buyerSignalPush,
    cacheWarmup,
    demoCleanup,
    emailDrip,
    federationSync,
    grantComplianceCheck,
    healthCheck,
    leadScoring,
    productionDispatch,
    redditBot,
    referralRewardDispatch,
    sessionIdentify,
    taskReminders,
  }
}

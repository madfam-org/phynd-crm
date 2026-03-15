import type { ConnectionOptions } from 'bullmq'
import { Queue } from 'bullmq'

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
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  })

  const cacheWarmup = new Queue('cache-warmup', {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  })

  const healthCheck = new Queue('health-check', {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  })

  const sessionIdentify = new Queue('session-identify', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  })

  const leadScoring = new Queue('lead-scoring', {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  })

  const taskReminders = new Queue('task-reminders', {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  })

  const demoCleanup = new Queue('demo-cleanup', {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  })

  return {
    cacheWarmup,
    demoCleanup,
    federationSync,
    healthCheck,
    leadScoring,
    sessionIdentify,
    taskReminders,
  }
}

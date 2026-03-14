import { createLogger } from '@phyne/logging'
import type { FederationProviderName } from '@phyne/types/federation'
import type { Job } from 'bullmq'
import { getFederationClient } from '../lib/federation'

const logger = createLogger('worker:cache-warmup')

interface CacheWarmupData {
  provider: FederationProviderName
  externalIds: string[]
  token: string
}

export async function processCacheWarmup(job: Job<CacheWarmupData>): Promise<void> {
  const { provider, externalIds, token } = job.data
  logger.info(
    { jobId: job.id, provider, count: externalIds.length },
    `Warming ${provider} cache for ${externalIds.length} entries`,
  )

  const client = getFederationClient(provider)

  for (const id of externalIds) {
    try {
      await client.fetch(id, token)
      logger.info({ provider, externalId: id }, `Warmed cache for ${provider}:${id}`)
    } catch (err) {
      logger.error({ provider, externalId: id, err }, `Failed to warm cache for ${provider}:${id}`)
    }
  }
}

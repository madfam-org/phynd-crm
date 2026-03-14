import { createLogger } from '@phyne/logging'
import type { FederationProviderName } from '@phyne/types/federation'
import type { Job } from 'bullmq'
import { getCacheManager, getFederationClient } from '../lib/federation'

const logger = createLogger('worker:federation-sync')

interface FederationSyncData {
  provider: FederationProviderName
  externalId: string
  action: 'invalidate' | 'refresh'
  token?: string
}

export async function processFederationSync(job: Job<FederationSyncData>): Promise<void> {
  const { provider, externalId, action, token } = job.data
  logger.info(
    { jobId: job.id, provider, externalId, action },
    `${action} ${provider}:${externalId}`,
  )

  const cache = getCacheManager()

  switch (action) {
    case 'invalidate': {
      await cache.invalidate(`fed:${provider}`, externalId)
      logger.info({ provider, externalId }, `Invalidated cache for ${provider}:${externalId}`)
      break
    }
    case 'refresh': {
      if (!token) {
        logger.warn(
          { provider, externalId },
          `No token provided for refresh of ${provider}:${externalId}`,
        )
        break
      }
      const client = getFederationClient(provider)
      await client.fetch(externalId, token)
      logger.info({ provider, externalId }, `Refreshed cache for ${provider}:${externalId}`)
      break
    }
  }
}

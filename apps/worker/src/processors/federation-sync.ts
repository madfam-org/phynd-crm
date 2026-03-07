import type { FederationProviderName } from '@phyne/types/federation'
import type { Job } from 'bullmq'
import { getCacheManager, getFederationClient } from '../lib/federation'

interface FederationSyncData {
  provider: FederationProviderName
  externalId: string
  action: 'invalidate' | 'refresh'
  token?: string
}

export async function processFederationSync(job: Job<FederationSyncData>): Promise<void> {
  const { provider, externalId, action, token } = job.data
  console.log(`[federation-sync] ${action} ${provider}:${externalId}`)

  const cache = getCacheManager()

  switch (action) {
    case 'invalidate': {
      await cache.invalidate(`fed:${provider}`, externalId)
      console.log(`[federation-sync] Invalidated cache for ${provider}:${externalId}`)
      break
    }
    case 'refresh': {
      if (!token) {
        console.warn(`[federation-sync] No token provided for refresh of ${provider}:${externalId}`)
        break
      }
      const client = getFederationClient(provider)
      await client.fetch(externalId, token)
      console.log(`[federation-sync] Refreshed cache for ${provider}:${externalId}`)
      break
    }
  }
}

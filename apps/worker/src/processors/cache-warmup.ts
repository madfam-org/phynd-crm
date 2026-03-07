import type { FederationProviderName } from '@phyne/types/federation'
import type { Job } from 'bullmq'
import { getFederationClient } from '../lib/federation'

interface CacheWarmupData {
  provider: FederationProviderName
  externalIds: string[]
  token: string
}

export async function processCacheWarmup(job: Job<CacheWarmupData>): Promise<void> {
  const { provider, externalIds, token } = job.data
  console.log(`[cache-warmup] Warming ${provider} cache for ${externalIds.length} entries`)

  const client = getFederationClient(provider)

  for (const id of externalIds) {
    try {
      await client.fetch(id, token)
      console.log(`  Warmed cache for ${provider}:${id}`)
    } catch (err) {
      console.error(`  Failed to warm cache for ${provider}:${id}`, err)
    }
  }
}

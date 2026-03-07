import { getDb } from '@phyne/db'
import { leads } from '@phyne/db/schema'
import { LeadScoringService } from '@phyne/services'
import type { Job } from 'bullmq'
import { getCacheManager } from '../lib/federation'

interface LeadScoringData {
  leadIds?: string[]
  all?: boolean
}

export async function processLeadScoring(job: Job<LeadScoringData>): Promise<void> {
  const { leadIds, all } = job.data
  console.log(
    `[lead-scoring] Computing scores for ${all ? 'all leads' : `${leadIds?.length ?? 0} leads`}`,
  )

  const db = getDb()
  const cache = getCacheManager()
  const ctx = {
    db,
    cache,
    auth: {
      userId: 'system',
      tenantId: 'madfam',
      roles: ['admin'],
      scopes: ['*'],
      accessToken: '',
    },
    tenantId: 'madfam',
  }

  const service = new LeadScoringService(ctx)

  let targetIds: string[]
  if (all) {
    const allLeads = await db.select({ id: leads.id }).from(leads)
    targetIds = allLeads.map((l) => l.id)
  } else {
    targetIds = leadIds ?? []
  }

  console.log(`[lead-scoring] Processing ${targetIds.length} lead(s)`)
  await service.batchCompute(targetIds)
  console.log('[lead-scoring] Scoring complete')
}

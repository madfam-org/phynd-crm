import { DEFAULT_TENANT_ID } from '@phyne/config/constants'
import { getDb } from '@phyne/db'
import { leads } from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
import { LeadScoringService } from '@phyne/services'
import type { Job } from 'bullmq'
import { getCacheManager } from '../lib/federation'

const logger = createLogger('worker:lead-scoring')

interface LeadScoringData {
  leadIds?: string[]
  all?: boolean
}

export async function processLeadScoring(job: Job<LeadScoringData>): Promise<void> {
  const { leadIds, all } = job.data
  logger.info(
    { jobId: job.id, all, count: leadIds?.length ?? 0 },
    `Computing scores for ${all ? 'all leads' : `${leadIds?.length ?? 0} leads`}`,
  )

  const db = getDb()
  const cache = getCacheManager()
  const ctx = {
    db,
    cache,
    auth: {
      userId: 'system',
      tenantId: DEFAULT_TENANT_ID,
      roles: ['admin'],
      scopes: ['*'],
      accessToken: '',
    },
    tenantId: DEFAULT_TENANT_ID,
  }

  const service = new LeadScoringService(ctx)

  let targetIds: string[]
  if (all) {
    const allLeads = await db.select({ id: leads.id }).from(leads)
    targetIds = allLeads.map((l) => l.id)
  } else {
    targetIds = leadIds ?? []
  }

  logger.info({ count: targetIds.length }, `Processing ${targetIds.length} lead(s)`)
  await service.batchCompute(targetIds)
  logger.info('Scoring complete')
}

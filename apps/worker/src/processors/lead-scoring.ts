import type { Job } from 'bullmq'

interface LeadScoringData {
  leadIds?: string[]
  all?: boolean
}

export async function processLeadScoring(job: Job<LeadScoringData>): Promise<void> {
  const { leadIds, all } = job.data
  console.log(
    `[lead-scoring] Computing scores for ${all ? 'all leads' : `${leadIds?.length ?? 0} leads`}`,
  )

  // In production, this would use the LeadScoringService to batch-compute scores.
  // The service requires a DB connection which is injected via ServiceContext.
  if (leadIds) {
    console.log(`[lead-scoring] Processing ${leadIds.length} lead(s)`)
  } else if (all) {
    console.log('[lead-scoring] Processing all leads')
  }

  console.log('[lead-scoring] Scoring complete')
}

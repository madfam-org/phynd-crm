import { getDb } from '@phyne/db'
import { grantApplications } from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'

const logger = createLogger('worker:grant-compliance-check')

interface GrantComplianceCheckData {
  grantApplicationId: string
  grantOpportunityId: string
  fortunaGrantId: string
}

interface KarafielComplianceResponse {
  rfc_active: boolean
  opinion_32d_positive: boolean
  blacklisted: boolean
}

export async function processGrantComplianceCheck(
  job: Job<GrantComplianceCheckData>,
): Promise<void> {
  const { grantApplicationId, grantOpportunityId, fortunaGrantId } = job.data

  logger.info(
    { jobId: job.id, grantApplicationId, fortunaGrantId },
    `Processing compliance check for grant application ${grantApplicationId}`,
  )

  const karafielUrl = process.env.KARAFIEL_API_URL
  const karafielKey = process.env.KARAFIEL_API_KEY

  if (!karafielUrl || !karafielKey) {
    logger.error('KARAFIEL_API_URL or KARAFIEL_API_KEY not configured')
    throw new Error('Karafiel API not configured')
  }

  const db = getDb()

  // Fetch the current application to check for RFC info
  const [application] = await db
    .select()
    .from(grantApplications)
    .where(eq(grantApplications.id, grantApplicationId))

  if (!application) {
    logger.warn({ grantApplicationId }, 'Grant application not found — skipping compliance check')
    return
  }

  // Extract RFC from application metadata or use fortunaGrantId as reference
  const metadata = (application.applicationDraft ?? {}) as Record<string, unknown>
  const rfc = (metadata.rfc as string) ?? fortunaGrantId

  const url = `${karafielUrl}/grants/compliance-status/${encodeURIComponent(rfc)}/`

  logger.info({ url, rfc }, 'Calling Karafiel compliance status API')

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${karafielKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown')
    logger.error(
      { status: response.status, body: text, rfc },
      'Karafiel compliance check API call failed',
    )
    throw new Error(`Karafiel API returned status ${response.status}`)
  }

  const compliance = (await response.json()) as KarafielComplianceResponse

  logger.info(
    {
      rfc,
      grantApplicationId,
      rfcActive: compliance.rfc_active,
      opinion32d: compliance.opinion_32d_positive,
      blacklisted: compliance.blacklisted,
    },
    'Compliance check result received',
  )

  // Update complianceChecks JSON on the grant application
  const complianceChecks = {
    rfc_active: compliance.rfc_active,
    opinion_32d_positive: compliance.opinion_32d_positive,
    blacklisted: compliance.blacklisted,
    checked_at: new Date().toISOString(),
  }

  await db
    .update(grantApplications)
    .set({ complianceChecks })
    .where(eq(grantApplications.id, grantApplicationId))

  logger.info(
    { grantApplicationId, complianceChecks },
    `Compliance checks updated for grant application ${grantApplicationId}`,
  )
}

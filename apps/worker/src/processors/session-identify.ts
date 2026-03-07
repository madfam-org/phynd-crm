import type { Job } from 'bullmq'

interface SessionIdentifyData {
  externalSessionId: string
  contactId: string
  fingerprint?: string
  ipCity?: string
  ipCountry?: string
  deviceType?: string
  browser?: string
  os?: string
  referrer?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  pageViewCount?: number
  duration?: number
  startedAt: string
  endedAt?: string
}

export async function processSessionIdentify(job: Job<SessionIdentifyData>): Promise<void> {
  const data = job.data
  console.log(
    `[session-identify] Processing session ${data.externalSessionId} → contact ${data.contactId}`,
  )

  // In production, this would use the VisitorTrackingService to upsert the session.
  // The service requires a DB connection which is injected via ServiceContext.
  // For now, log the event for the worker to process when wired to the DB.
  console.log(
    `[session-identify] Session ${data.externalSessionId} identified for contact ${data.contactId}`,
  )
}

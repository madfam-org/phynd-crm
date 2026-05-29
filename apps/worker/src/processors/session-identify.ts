import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { VisitorTrackingService } from '@phynd/services'
import type { Job } from 'bullmq'
import { getCacheManager } from '../lib/federation'

const logger = createLogger('worker:session-identify')

interface SessionIdentifyData {
  tenantId?: string
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
  logger.info(
    { jobId: job.id, externalSessionId: data.externalSessionId, contactId: data.contactId },
    `Processing session ${data.externalSessionId} for contact ${data.contactId}`,
  )

  const tenantId = data.tenantId ?? DEFAULT_TENANT_ID
  const db = getDb(tenantId)
  const cache = getCacheManager()
  const ctx = {
    db,
    cache,
    auth: {
      userId: 'system',
      tenantId,
      roles: ['admin'],
      scopes: ['*'],
      accessToken: '',
    },
    tenantId,
  }

  const service = new VisitorTrackingService(ctx)

  await service.upsertFromWebhook({
    externalSessionId: data.externalSessionId,
    fingerprint: data.fingerprint ?? 'unknown',
    contactId: data.contactId,
    ipCity: data.ipCity,
    ipCountry: data.ipCountry,
    deviceType: data.deviceType,
    browser: data.browser,
    os: data.os,
    referrer: data.referrer,
    utmSource: data.utmSource,
    utmMedium: data.utmMedium,
    utmCampaign: data.utmCampaign,
    utmTerm: data.utmTerm,
    utmContent: data.utmContent,
    startedAt: new Date(data.startedAt),
    endedAt: data.endedAt ? new Date(data.endedAt) : undefined,
  })

  logger.info(
    { externalSessionId: data.externalSessionId, contactId: data.contactId },
    `Session ${data.externalSessionId} identified for contact ${data.contactId}`,
  )
}

import { getCacheManager } from '@/lib/federation/clients'
import { resolveRedisUrl } from '@phynd/config/connections'
import { getDb } from '@phynd/db'
import { visitorPageViews, visitorSessions } from '@phynd/db/schema'
import { createLogger } from '@phynd/logging'
import { VisitorTrackingService, createServiceContext } from '@phynd/services'
import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'

const logger = createLogger('web:janua-telemetry-handler')

export async function handleJanuaTelemetryEvent(
  payload: Record<string, unknown>,
  eventType: string,
  tenantId: string,
) {
  if (eventType === 'visitor.identified') {
    await handleVisitorIdentified(payload, tenantId)
    return
  }

  if (eventType === 'visitor.page_viewed') {
    await handleVisitorPageViewed(payload, tenantId)
  }
}

async function handleVisitorPageViewed(payload: Record<string, unknown>, tenantId: string) {
  const externalSessionId = payload.externalSessionId as string | undefined
  const pageViews = payload.pageViews as
    | Array<{ url: string; title?: string; duration?: number; viewedAt?: string }>
    | undefined

  if (!externalSessionId) return

  const db = getDb(tenantId)
  const service = createVisitorService(db, tenantId)

  if (!pageViews?.length) {
    await service.upsertFromWebhook({
      externalSessionId,
      fingerprint: (payload.fingerprint as string | undefined) ?? 'unknown',
      startedAt: new Date((payload.startedAt as string | undefined) ?? Date.now()),
    })
    return
  }

  let session = await db
    .select({ id: visitorSessions.id })
    .from(visitorSessions)
    .where(eq(visitorSessions.externalSessionId, externalSessionId))
    .limit(1)

  if (!session[0]) {
    await service.upsertFromWebhook({
      externalSessionId,
      fingerprint: (payload.fingerprint as string | undefined) ?? 'unknown',
      pageViewCount: pageViews.length,
      startedAt: new Date((payload.startedAt as string | undefined) ?? Date.now()),
    })
    session = await db
      .select({ id: visitorSessions.id })
      .from(visitorSessions)
      .where(eq(visitorSessions.externalSessionId, externalSessionId))
      .limit(1)
  }

  const sessionRow = session[0]
  if (!sessionRow) return

  const values = pageViews.map((pv) => ({
    sessionId: sessionRow.id,
    url: pv.url,
    title: pv.title,
    duration: pv.duration,
    viewedAt: pv.viewedAt ? new Date(pv.viewedAt) : new Date(),
  }))

  await db.insert(visitorPageViews).values(values)
}

async function handleVisitorIdentified(payload: Record<string, unknown>, tenantId: string) {
  const externalSessionId = payload.externalSessionId as string | undefined
  const contactId =
    (payload.contactId as string | undefined) ?? (payload.contact_id as string | undefined)

  if (!externalSessionId || !contactId) {
    logger.warn({ payload }, 'visitor.identified missing externalSessionId or contactId')
    return
  }

  const db = getDb(tenantId)
  const service = createVisitorService(db, tenantId)

  await service.upsertFromWebhook({
    externalSessionId,
    fingerprint: (payload.fingerprint as string | undefined) ?? 'unknown',
    contactId,
    identified: true,
    ipCity: payload.ipCity as string | undefined,
    ipCountry: payload.ipCountry as string | undefined,
    deviceType: payload.deviceType as string | undefined,
    browser: payload.browser as string | undefined,
    os: payload.os as string | undefined,
    referrer: payload.referrer as string | undefined,
    utmSource: payload.utmSource as string | undefined,
    utmMedium: payload.utmMedium as string | undefined,
    utmCampaign: payload.utmCampaign as string | undefined,
    utmTerm: payload.utmTerm as string | undefined,
    utmContent: payload.utmContent as string | undefined,
    pageViewCount: payload.pageViewCount as number | undefined,
    duration: payload.duration as number | undefined,
    startedAt: new Date((payload.startedAt as string | undefined) ?? Date.now()),
    endedAt: payload.endedAt ? new Date(payload.endedAt as string) : undefined,
  })

  await enqueueSessionIdentify({
    tenantId,
    externalSessionId,
    contactId,
    fingerprint: payload.fingerprint as string | undefined,
    startedAt: (payload.startedAt as string | undefined) ?? new Date().toISOString(),
  })
}

function createVisitorService(db: ReturnType<typeof getDb>, tenantId: string) {
  return new VisitorTrackingService(
    createServiceContext(db, getCacheManager(), {
      userId: 'system:janua-telemetry',
      tenantId,
      roles: ['service'],
      scopes: ['visitorTracking:read', 'visitorTracking:write'],
      accessToken: '',
    }),
  )
}

async function enqueueSessionIdentify(data: {
  tenantId: string
  externalSessionId: string
  contactId: string
  fingerprint?: string
  startedAt: string
}) {
  try {
    const redisUrl = resolveRedisUrl()
    const url = new URL(redisUrl)
    const connection = {
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
    }
    const queue = new Queue('session-identify', { connection })
    await queue.add(
      'identify',
      {
        tenantId: data.tenantId,
        externalSessionId: data.externalSessionId,
        contactId: data.contactId,
        fingerprint: data.fingerprint,
        startedAt: data.startedAt,
      },
      { jobId: `identify:${data.tenantId}:${data.externalSessionId}:${data.contactId}` },
    )
    await queue.close()
  } catch (err) {
    logger.warn(
      { err, externalSessionId: data.externalSessionId, contactId: data.contactId },
      'Failed to enqueue session-identify — non-blocking',
    )
  }
}

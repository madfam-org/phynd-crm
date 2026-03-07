import { visitorSessions } from '@phyne/db/schema'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class VisitorTrackingService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(opts?: { identified?: boolean; limit?: number }) {
    const conditions = []
    if (opts?.identified === true) {
      conditions.push(eq(visitorSessions.identified, true))
    } else if (opts?.identified === false) {
      conditions.push(eq(visitorSessions.identified, false))
    }

    return this.ctx.db
      .select()
      .from(visitorSessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(visitorSessions.startedAt))
      .limit(opts?.limit ?? 100)
  }

  async getByContactId(contactId: string) {
    return this.ctx.db
      .select()
      .from(visitorSessions)
      .where(eq(visitorSessions.contactId, contactId))
      .orderBy(desc(visitorSessions.startedAt))
  }

  async getAnonymous(limit = 50) {
    return this.ctx.db
      .select()
      .from(visitorSessions)
      .where(isNull(visitorSessions.contactId))
      .orderBy(desc(visitorSessions.startedAt))
      .limit(limit)
  }

  async identifySession(sessionId: string, contactId: string) {
    const [updated] = await this.ctx.db
      .update(visitorSessions)
      .set({ contactId, identified: true })
      .where(eq(visitorSessions.id, sessionId))
      .returning()
    return updated ?? null
  }

  async upsertFromWebhook(data: {
    externalSessionId: string
    fingerprint?: string
    contactId?: string
    identified?: boolean
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
    startedAt: Date
    endedAt?: Date
  }) {
    const existing = await this.ctx.db
      .select()
      .from(visitorSessions)
      .where(eq(visitorSessions.externalSessionId, data.externalSessionId))
      .limit(1)

    if (existing.length > 0) {
      const [updated] = await this.ctx.db
        .update(visitorSessions)
        .set({
          contactId: data.contactId ?? existing[0]?.contactId,
          identified: data.identified ?? existing[0]?.identified,
          pageViewCount: data.pageViewCount ?? existing[0]?.pageViewCount,
          duration: data.duration ?? existing[0]?.duration,
          endedAt: data.endedAt ?? existing[0]?.endedAt,
        })
        .where(eq(visitorSessions.externalSessionId, data.externalSessionId))
        .returning()
      return updated ?? null
    }

    const [created] = await this.ctx.db.insert(visitorSessions).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return created!
  }

  async getMetrics() {
    const [result] = await this.ctx.db
      .select({
        totalSessions: sql<number>`count(*)::int`,
        identifiedSessions: sql<number>`count(*) filter (where ${visitorSessions.identified} = true)::int`,
        anonymousSessions: sql<number>`count(*) filter (where ${visitorSessions.identified} = false)::int`,
        avgDuration: sql<number>`coalesce(avg(${visitorSessions.duration}), 0)::int`,
      })
      .from(visitorSessions)

    return (
      result ?? { totalSessions: 0, identifiedSessions: 0, anonymousSessions: 0, avgDuration: 0 }
    )
  }
}

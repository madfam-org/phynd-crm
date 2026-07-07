import { campaignBuyerSignals } from '@phynd/db/schema'
import { and, eq, gte } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export type BuyerSignalEventType =
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'replied'
  | 'interested'
  | 'rejected'
  | 'unsubscribed'
  | 'booked'
  | 'converted'
  | 'suppressed'

export type RecordBuyerSignalInput = {
  campaignId: string
  contactId?: string
  skuKey: string
  contactSegment?: string | null
  eventType: BuyerSignalEventType
  signalStrength?: 'low' | 'medium' | 'high'
  notesRedacted?: string
  dedupKey: string
  metadata?: Record<string, unknown>
  occurredAt?: Date
}

export type TulanaBuyerSignalExport = {
  sku_key: string
  campaign_id: string
  contact_segment: string | null
  event_type: BuyerSignalEventType
  occurred_at: string
  signal_strength: string | null
  notes_redacted: string | null
}

export class CampaignBuyerSignalService {
  constructor(private readonly ctx: ServiceContext) {}

  async record(input: RecordBuyerSignalInput) {
    const [existing] = await this.ctx.db
      .select({ id: campaignBuyerSignals.id })
      .from(campaignBuyerSignals)
      .where(eq(campaignBuyerSignals.dedupKey, input.dedupKey))
      .limit(1)

    if (existing) {
      return { id: existing.id, deduplicated: true }
    }

    const [row] = await this.ctx.db
      .insert(campaignBuyerSignals)
      .values({
        campaignId: input.campaignId,
        contactId: input.contactId,
        skuKey: input.skuKey,
        contactSegment: input.contactSegment ?? null,
        eventType: input.eventType,
        signalStrength: input.signalStrength ?? null,
        notesRedacted: input.notesRedacted ?? null,
        dedupKey: input.dedupKey,
        metadata: input.metadata ?? {},
        occurredAt: input.occurredAt ?? new Date(),
      })
      .returning()

    return { id: row?.id ?? '', deduplicated: false }
  }

  async listForTulanaExport(filters?: {
    skuKey?: string
    since?: Date
    limit?: number
  }): Promise<TulanaBuyerSignalExport[]> {
    const limit = filters?.limit ?? 200
    const conditions = []
    if (filters?.skuKey) {
      conditions.push(eq(campaignBuyerSignals.skuKey, filters.skuKey))
    }
    if (filters?.since) {
      conditions.push(gte(campaignBuyerSignals.occurredAt, filters.since))
    }

    const rows = await this.ctx.db
      .select()
      .from(campaignBuyerSignals)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(campaignBuyerSignals.occurredAt)
      .limit(limit)

    return rows.map((row) => ({
      sku_key: row.skuKey,
      campaign_id: row.campaignId,
      contact_segment: row.contactSegment,
      event_type: row.eventType as BuyerSignalEventType,
      occurred_at: row.occurredAt.toISOString(),
      signal_strength: row.signalStrength,
      notes_redacted: row.notesRedacted,
    }))
  }
}

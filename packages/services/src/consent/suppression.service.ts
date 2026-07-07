import { suppressionEntries } from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt, inArray } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { ValidationError } from '../errors'
import { normalizeConsentIdentifier } from './consent-state-machine'

export const SUPPRESSION_CHANNELS = ['all', 'email', 'sms', 'whatsapp'] as const
export type SuppressionChannel = (typeof SUPPRESSION_CHANNELS)[number]

export const SUPPRESSION_REASONS = [
  'complaint',
  'hard_bounce',
  'unsubscribe',
  'manual',
  'legal_request',
] as const
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number]

export type AddSuppressionInput = {
  identifier: string
  channel?: SuppressionChannel
  reason: SuppressionReason
  source: string
  evidence?: string
  metadata?: Record<string, unknown>
}

export type SuppressionCheckResult = {
  suppressed: boolean
  entries: (typeof suppressionEntries.$inferSelect)[]
}

/**
 * Cross-product suppression list. An entry here beats ANY consent status —
 * the send gate checks suppression first and never overrides it.
 */
export class SuppressionService {
  constructor(private readonly ctx: ServiceContext) {}

  /** Idempotent add — an existing (identifier, channel) entry is returned as-is. */
  async add(input: AddSuppressionInput) {
    const identifier = normalizeConsentIdentifier(input.identifier)
    if (!identifier) {
      throw new ValidationError('Suppression identifier is required')
    }
    const channel = input.channel ?? 'all'
    if (!(SUPPRESSION_CHANNELS as readonly string[]).includes(channel)) {
      throw new ValidationError(`Invalid suppression channel: ${channel}`)
    }

    const [existing] = await this.ctx.db
      .select()
      .from(suppressionEntries)
      .where(
        and(eq(suppressionEntries.identifier, identifier), eq(suppressionEntries.channel, channel)),
      )
      .limit(1)

    if (existing) {
      return { entry: existing, created: false }
    }

    const [entry] = await this.ctx.db
      .insert(suppressionEntries)
      .values({
        identifier,
        channel,
        reason: input.reason,
        source: input.source,
        evidence: input.evidence ?? null,
        metadata: input.metadata ?? {},
      })
      .returning()

    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return { entry: entry!, created: true }
  }

  /**
   * Checks whether `identifier` is suppressed on `channel`. Entries with
   * channel `all` suppress every channel.
   */
  async check(identifier: string, channel: SuppressionChannel): Promise<SuppressionCheckResult> {
    const normalized = normalizeConsentIdentifier(identifier)
    if (!normalized) {
      return { suppressed: false, entries: [] }
    }
    const channels: SuppressionChannel[] = channel === 'all' ? ['all'] : ['all', channel]

    const entries = await this.ctx.db
      .select()
      .from(suppressionEntries)
      .where(
        and(
          eq(suppressionEntries.identifier, normalized),
          inArray(suppressionEntries.channel, channels),
        ),
      )

    return { suppressed: entries.length > 0, entries }
  }

  async list(
    pagination?: PaginationInput,
    filters?: { channel?: SuppressionChannel; reason?: SuppressionReason; identifier?: string },
  ): Promise<PaginatedResult<typeof suppressionEntries.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(suppressionEntries.id, pagination.cursor))
    }
    if (filters?.channel) {
      conditions.push(eq(suppressionEntries.channel, filters.channel))
    }
    if (filters?.reason) {
      conditions.push(eq(suppressionEntries.reason, filters.reason))
    }
    if (filters?.identifier) {
      conditions.push(
        eq(suppressionEntries.identifier, normalizeConsentIdentifier(filters.identifier)),
      )
    }

    const rows = await this.ctx.db
      .select()
      .from(suppressionEntries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(suppressionEntries.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  /** Admin-only removal (e.g. a mistaken manual entry). */
  async remove(id: string) {
    const [deleted] = await this.ctx.db
      .delete(suppressionEntries)
      .where(eq(suppressionEntries.id, id))
      .returning()
    return deleted ?? null
  }
}

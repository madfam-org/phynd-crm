import { campaigns } from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt, isNotNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError, ValidationError } from '../errors'
import { CampaignBuyerSignalService } from './campaign-buyer-signal.service'
import { type CampaignSendEligibility, checkCampaignSendEligibility } from './campaign-send-gate'
import { recordTulanaCommercialGaG4Evidence } from './tulana-commercial-ga-evidence'

const PAID_GA_CAMPAIGN_TYPES = new Set([
  'paid_ga',
  'paid_revenue',
  'revenue_campaign',
  'campaign_ga',
])

const CANDIDATE_ALLOWED_CAMPAIGN_TYPES = new Set([
  'controlled_pilot',
  'warm_pilot',
  'discovery',
  'waitlist',
])

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : null
}

function assertCommercialGaCampaignAllowed(campaign: {
  gaReadiness: string | null
  tulanaMetadata: Record<string, unknown> | null
}) {
  const commercialGaStatus = metadataString(campaign.tulanaMetadata, 'commercial_ga_status')
  const campaignType = metadataString(campaign.tulanaMetadata, 'campaign_type')

  if (campaign.gaReadiness === 'not_ready') {
    throw new ValidationError(
      'Cannot approve send: Tulana marks this SKU as not_ready. Reject or wait for readiness evidence.',
    )
  }

  if (commercialGaStatus === 'blocked' || commercialGaStatus === 'paused') {
    throw new ValidationError(
      `Cannot approve send: Tulana commercial GA status is ${commercialGaStatus}.`,
    )
  }

  if (
    campaignType &&
    PAID_GA_CAMPAIGN_TYPES.has(campaignType) &&
    commercialGaStatus !== 'ga_ready'
  ) {
    throw new ValidationError('Cannot approve paid-GA campaign unless Tulana status is ga_ready.')
  }

  if (
    commercialGaStatus === 'candidate' &&
    campaignType &&
    !CANDIDATE_ALLOWED_CAMPAIGN_TYPES.has(campaignType)
  ) {
    throw new ValidationError(
      'Candidate SKUs are limited to controlled_pilot, warm_pilot, discovery, or waitlist campaigns.',
    )
  }
}

export type CampaignListFilters = {
  status?: string
  importSource?: string
  gaReadiness?: string
  skuKey?: string
  tulanaOnly?: boolean
}

export class CampaignsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
    filters?: CampaignListFilters,
  ): Promise<PaginatedResult<typeof campaigns.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(campaigns.id, pagination.cursor))
    }
    if (filters?.status) {
      conditions.push(eq(campaigns.status, filters.status))
    }
    if (filters?.importSource) {
      conditions.push(eq(campaigns.importSource, filters.importSource))
    }
    if (filters?.gaReadiness) {
      conditions.push(eq(campaigns.gaReadiness, filters.gaReadiness))
    }
    if (filters?.skuKey) {
      conditions.push(eq(campaigns.skuKey, filters.skuKey))
    }
    if (filters?.tulanaOnly) {
      conditions.push(isNotNull(campaigns.skuKey))
    }

    const rows = await this.ctx.db
      .select()
      .from(campaigns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(campaigns.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async getById(id: string) {
    const [campaign] = await this.ctx.db.select().from(campaigns).where(eq(campaigns.id, id))
    return campaign ?? null
  }

  /**
   * Look up a campaign by its `utm_campaign` slug — used by inbound webhooks
   * (ceq, cotiza, tezca landing pages) that carry UTM params from a paid
   * marketing source. Caller is responsible for normalizing the slug
   * casing; this method does an exact match.
   *
   * Returns the first active campaign whose `utm_campaign` matches, or
   * null when no match is found. When multiple campaigns share the same
   * utm_campaign value (e.g. seasonal re-runs), the earliest by `createdAt`
   * wins to keep attribution stable across the campaign's lifetime.
   */
  async getByUtmCampaign(utmCampaign: string) {
    if (!utmCampaign) return null
    const [campaign] = await this.ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.utmCampaign, utmCampaign))
      .orderBy(campaigns.createdAt)
      .limit(1)
    return campaign ?? null
  }

  async create(data: {
    name: string
    description?: string
    channel?: string
    status?: string
    utmSource?: string
    utmMedium?: string
    utmCampaign?: string
    budget?: string
    currency?: string
    startDate?: Date
    endDate?: Date
    offerId?: string
  }) {
    const [campaign] = await this.ctx.db.insert(campaigns).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return campaign!
  }

  async update(
    id: string,
    data: Partial<{
      name: string
      description: string
      channel: string
      status: string
      utmSource: string
      utmMedium: string
      utmCampaign: string
      budget: string
      spend: string
      currency: string
      startDate: Date
      endDate: Date
      offerId: string
    }>,
  ) {
    const [campaign] = await this.ctx.db
      .update(campaigns)
      .set(data)
      .where(eq(campaigns.id, id))
      .returning()
    return campaign ?? null
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db.delete(campaigns).where(eq(campaigns.id, id)).returning()
    return deleted ?? null
  }

  /**
   * Human review gate for Tulana-imported campaigns. Blocks approval when the
   * SKU is explicitly not GA-ready.
   */
  async reviewTulanaImport(id: string, decision: 'approved' | 'rejected') {
    const campaign = await this.getById(id)
    if (!campaign) {
      throw new NotFoundError('Campaign', id)
    }
    if (!campaign.skuKey) {
      throw new ValidationError('Campaign is not a Tulana SKU import')
    }

    if (decision === 'rejected') {
      return this.update(id, { status: 'rejected' })
    }

    assertCommercialGaCampaignAllowed(campaign)

    return this.update(id, { status: 'approved' })
  }

  async getSendEligibility(
    campaignId: string,
    contactId: string,
  ): Promise<CampaignSendEligibility> {
    return checkCampaignSendEligibility(this.ctx, { campaignId, contactId })
  }

  /**
   * Tulana outreach dispatch with consent/suppression gates (Phase 3.4).
   * Records a buyer-signal row for Tulana export (Phase 3.5).
   */
  async attemptTulanaSend(campaignId: string, contactId: string) {
    const campaign = await this.getById(campaignId)
    if (!campaign) {
      throw new NotFoundError('Campaign', campaignId)
    }
    if (!campaign.skuKey) {
      throw new ValidationError('Campaign is not a Tulana SKU import')
    }
    if (campaign.status !== 'approved' && campaign.status !== 'scheduled') {
      throw new ValidationError('Campaign must be approved or scheduled before send')
    }
    assertCommercialGaCampaignAllowed(campaign)

    const eligibility = await checkCampaignSendEligibility(this.ctx, { campaignId, contactId })
    const signalService = new CampaignBuyerSignalService(this.ctx)
    const contactSegment =
      (campaign.tulanaMetadata?.audience as string | undefined) ?? campaign.orchestrator ?? null
    const dedupKey = `send:${campaignId}:${contactId}`

    if (!eligibility.eligible) {
      await signalService.record({
        campaignId,
        contactId,
        skuKey: campaign.skuKey,
        contactSegment,
        eventType: 'suppressed',
        signalStrength: 'low',
        notesRedacted: eligibility.reasons.join(', '),
        dedupKey,
        metadata: { channel: eligibility.channel, reasons: eligibility.reasons },
      })

      await this.update(campaignId, { status: 'suppressed' })

      return {
        outcome: 'suppressed' as const,
        reasons: eligibility.reasons,
        channel: eligibility.channel,
      }
    }

    await signalService.record({
      campaignId,
      contactId,
      skuKey: campaign.skuKey,
      contactSegment,
      eventType: 'delivered',
      signalStrength: 'medium',
      dedupKey,
      metadata: { channel: eligibility.channel },
    })

    await this.update(campaignId, { status: 'sent' })
    await recordTulanaCommercialGaG4Evidence({
      campaignId,
      contactId,
      skuKey: campaign.skuKey,
      channel: eligibility.channel,
      tulanaMetadata: campaign.tulanaMetadata,
    })

    return {
      outcome: 'sent' as const,
      reasons: [] as string[],
      channel: eligibility.channel,
    }
  }
}

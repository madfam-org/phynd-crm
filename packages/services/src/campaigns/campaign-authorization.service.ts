import crypto from 'node:crypto'
import {
  campaignAuthorizations,
  campaignDraftVariants,
  campaigns,
  consentRecords,
  contacts,
  suppressionEntries,
} from '@phynd/db/schema'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { resolveSenderIdentity } from '../email/email.service'
import { campaignVariantEmail } from '../email/templates/campaign-variant'
import { NotFoundError, ValidationError } from '../errors'
import { resolveCampaignPrivacyUrl } from './campaign-privacy'
import { resolveOutreachChannel } from './campaign-send-gate'

// ---------------------------------------------------------------------------
// Campaign authorization — the human money-approval gate (G4 owner surface).
//
// A campaign send is only possible against an `authorized` row whose
// payloadHash matches the campaign's CURRENT authorization payload. The
// payload covers everything the owner materially approved: identity, sender,
// schedule, audience definition, and every copy variant. Live consent counts
// are captured in the snapshot for honest review context but are NOT hashed —
// organic double-opt-in growth must not invalidate an authorization, while
// any copy/schedule/sender/audience-definition edit must.
// ---------------------------------------------------------------------------

type CampaignRow = typeof campaigns.$inferSelect
type VariantRow = typeof campaignDraftVariants.$inferSelect

export type AuthorizedVariantPayload = {
  variantId: string | null
  language: string | null
  subject: string | null
  preheader: string | null
  body: string
  cta: string | null
  ctaUrl: string | null
  claimKeysUsed: string[]
}

export type CampaignAuthorizationPayload = {
  campaignId: string
  name: string
  skuKey: string | null
  channel: string
  sender: string
  privacyUrl: string | null
  schedule: { startDate: string | null; endDate: string | null }
  audienceDefinition: string | null
  campaignType: string | null
  guardrailsDoNotClaim: string[]
  variants: AuthorizedVariantPayload[]
}

export type ConsentCoverage = {
  /** Active (non-deleted) contacts that have an email address. */
  contactsWithEmail: number
  /** Distinct contact emails per channel-scoped email consent status. */
  consent: { granted: number; pendingDoubleOptIn: number; revoked: number }
  /** Distinct contact emails on the suppression list (email or all). */
  suppressed: number
  /** Granted email consent AND not suppressed — sendable by consent today. */
  grantedNotSuppressed: number
}

export type CampaignAuthorizationContext = {
  capturedAt: string
  campaignStatus: string
  gaReadiness: string | null
  commercialGaStatus: string | null
  importSource: string | null
  orchestrator: string | null
  coverage: ConsentCoverage
  proofPoints: { label: string; value: string; source_url?: string }[]
}

export type CampaignAuthorizationSnapshot = {
  version: 1
  payload: CampaignAuthorizationPayload
  context: CampaignAuthorizationContext
}

// ---------------------------------------------------------------------------
// Canonical hashing
// ---------------------------------------------------------------------------

/** Deterministic JSON: recursively sorted object keys, undefined dropped. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

export function hashAuthorizationPayload(payload: CampaignAuthorizationPayload): string {
  return crypto.createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// Payload / snapshot construction
// ---------------------------------------------------------------------------

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : null
}

/** Pure builder for the hashed authorization payload. */
export function buildAuthorizationPayload(
  campaign: CampaignRow,
  variants: VariantRow[],
  sender: string,
): CampaignAuthorizationPayload {
  const metadata = campaign.tulanaMetadata ?? null
  const guardrails = (metadata?.guardrails ?? null) as { do_not_claim?: string[] } | null
  return {
    campaignId: campaign.id,
    name: campaign.name,
    skuKey: campaign.skuKey ?? null,
    channel: resolveOutreachChannel(campaign),
    sender,
    privacyUrl: resolveCampaignPrivacyUrl(campaign.skuKey) ?? null,
    schedule: {
      startDate: campaign.startDate ? new Date(campaign.startDate).toISOString() : null,
      endDate: campaign.endDate ? new Date(campaign.endDate).toISOString() : null,
    },
    audienceDefinition: metadataString(metadata, 'audience') ?? campaign.orchestrator ?? null,
    campaignType: metadataString(metadata, 'campaign_type'),
    guardrailsDoNotClaim: Array.isArray(guardrails?.do_not_claim) ? guardrails.do_not_claim : [],
    variants: variants.map((variant) => ({
      variantId: variant.variantId ?? null,
      language: variant.language ?? null,
      subject: variant.subject ?? null,
      preheader: variant.preheader ?? null,
      body: variant.body,
      cta: variant.cta ?? null,
      ctaUrl: variant.ctaUrl ?? null,
      claimKeysUsed: Array.isArray(variant.claimKeysUsed) ? variant.claimKeysUsed : [],
    })),
  }
}

/** Variants in the same deterministic order the dispatch path uses. */
export async function loadCampaignVariants(
  ctx: ServiceContext,
  campaignId: string,
): Promise<VariantRow[]> {
  return ctx.db
    .select()
    .from(campaignDraftVariants)
    .where(eq(campaignDraftVariants.campaignId, campaignId))
    .orderBy(asc(campaignDraftVariants.createdAt), asc(campaignDraftVariants.id))
}

/**
 * Honest audience numbers for the review surface. These are real aggregates
 * over the tenant's contact base + consent ledger at capture time — final
 * eligibility is still evaluated per contact at send time by the consent
 * gate (suppression always wins).
 */
export async function loadConsentCoverage(ctx: ServiceContext): Promise<ConsentCoverage> {
  const contactEmailJoin = and(
    eq(sql`lower(${contacts.email})`, consentRecords.identifier),
    isNull(contacts.deletedAt),
  )

  const [contactsRow] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(isNull(contacts.deletedAt), isNotNull(contacts.email)))

  const statusRows = await ctx.db
    .select({
      status: consentRecords.status,
      n: sql<number>`count(distinct ${consentRecords.identifier})::int`,
    })
    .from(consentRecords)
    .innerJoin(contacts, contactEmailJoin)
    .where(eq(consentRecords.channel, 'email'))
    .groupBy(consentRecords.status)

  const [suppressedRow] = await ctx.db
    .select({ n: sql<number>`count(distinct ${suppressionEntries.identifier})::int` })
    .from(suppressionEntries)
    .innerJoin(
      contacts,
      and(
        eq(sql`lower(${contacts.email})`, suppressionEntries.identifier),
        isNull(contacts.deletedAt),
      ),
    )
    .where(inArray(suppressionEntries.channel, ['email', 'all']))

  const [grantedNotSuppressedRow] = await ctx.db
    .select({ n: sql<number>`count(distinct ${consentRecords.identifier})::int` })
    .from(consentRecords)
    .innerJoin(contacts, contactEmailJoin)
    .where(
      and(
        eq(consentRecords.channel, 'email'),
        eq(consentRecords.status, 'granted'),
        sql`not exists (select 1 from ${suppressionEntries} where ${suppressionEntries.identifier} = ${consentRecords.identifier} and ${suppressionEntries.channel} in ('email', 'all'))`,
      ),
    )

  const byStatus = (status: string): number =>
    Number(statusRows.find((row) => row.status === status)?.n ?? 0)

  return {
    contactsWithEmail: Number(contactsRow?.n ?? 0),
    consent: {
      granted: byStatus('granted'),
      pendingDoubleOptIn: byStatus('pending_double_opt_in'),
      revoked: byStatus('revoked'),
    },
    suppressed: Number(suppressedRow?.n ?? 0),
    grantedNotSuppressed: Number(grantedNotSuppressedRow?.n ?? 0),
  }
}

export async function composeCampaignAuthorizationSnapshot(
  ctx: ServiceContext,
  campaign: CampaignRow,
): Promise<{ snapshot: CampaignAuthorizationSnapshot; payloadHash: string }> {
  const variants = await loadCampaignVariants(ctx, campaign.id)
  const coverage = await loadConsentCoverage(ctx)
  const payload = buildAuthorizationPayload(campaign, variants, resolveSenderIdentity())
  const metadata = campaign.tulanaMetadata ?? null
  const proofPoints = (metadata?.proof_points ?? []) as CampaignAuthorizationContext['proofPoints']

  const snapshot: CampaignAuthorizationSnapshot = {
    version: 1,
    payload,
    context: {
      capturedAt: new Date().toISOString(),
      campaignStatus: campaign.status,
      gaReadiness: campaign.gaReadiness ?? null,
      commercialGaStatus: metadataString(metadata, 'commercial_ga_status'),
      importSource: campaign.importSource ?? null,
      orchestrator: campaign.orchestrator ?? null,
      coverage,
      proofPoints: Array.isArray(proofPoints) ? proofPoints : [],
    },
  }
  return { snapshot, payloadHash: hashAuthorizationPayload(payload) }
}

/**
 * Render a snapshot variant through the exact production email pipeline
 * (`campaignVariantEmail`), minus the per-contact unsubscribe URL which is
 * generated at send time. The preview footer states this explicitly.
 */
export function renderSnapshotVariant(
  payload: CampaignAuthorizationPayload,
  variant: AuthorizedVariantPayload,
): { subject: string; html: string; preheader?: string } {
  return campaignVariantEmail({
    subject: variant.subject ?? payload.name,
    body: variant.body,
    preheader: variant.preheader,
    cta: variant.cta,
    ctaUrl: variant.ctaUrl,
    unsubscribeUrl: undefined,
    privacyUrl: payload.privacyUrl ?? undefined,
  })
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type AuthorizationDecision = 'authorized' | 'rejected'

export class CampaignAuthorizationService {
  constructor(private readonly ctx: ServiceContext) {}

  private async getCampaign(campaignId: string): Promise<CampaignRow> {
    const [campaign] = await this.ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
    if (!campaign) {
      throw new NotFoundError('Campaign', campaignId)
    }
    return campaign
  }

  /**
   * Create a pending authorization request for a campaign, superseding any
   * previous pending request (only one live request per campaign).
   */
  async request(campaignId: string, requestedBy: string) {
    const campaign = await this.getCampaign(campaignId)
    const variants = await loadCampaignVariants(this.ctx, campaignId)
    if (variants.length === 0) {
      throw new ValidationError('Campaign has no draft variants — nothing reviewable to authorize')
    }

    const { snapshot, payloadHash } = await composeCampaignAuthorizationSnapshot(this.ctx, campaign)

    await this.ctx.db
      .update(campaignAuthorizations)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(campaignAuthorizations.campaignId, campaignId),
          eq(campaignAuthorizations.status, 'pending'),
        ),
      )

    const [record] = await this.ctx.db
      .insert(campaignAuthorizations)
      .values({
        campaignId,
        status: 'pending',
        payloadHash,
        snapshot: snapshot as unknown as Record<string, unknown>,
        requestedBy,
      })
      .returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return record!
  }

  async listPending() {
    return this.ctx.db
      .select({
        authorization: campaignAuthorizations,
        campaign: {
          id: campaigns.id,
          name: campaigns.name,
          skuKey: campaigns.skuKey,
          status: campaigns.status,
          gaReadiness: campaigns.gaReadiness,
          startDate: campaigns.startDate,
          endDate: campaigns.endDate,
        },
      })
      .from(campaignAuthorizations)
      .innerJoin(campaigns, eq(campaignAuthorizations.campaignId, campaigns.id))
      .where(eq(campaignAuthorizations.status, 'pending'))
      .orderBy(desc(campaignAuthorizations.createdAt))
  }

  async listRecentDecided(limit = 20) {
    return this.ctx.db
      .select({
        authorization: campaignAuthorizations,
        campaign: {
          id: campaigns.id,
          name: campaigns.name,
          skuKey: campaigns.skuKey,
          status: campaigns.status,
          gaReadiness: campaigns.gaReadiness,
          startDate: campaigns.startDate,
          endDate: campaigns.endDate,
        },
      })
      .from(campaignAuthorizations)
      .innerJoin(campaigns, eq(campaignAuthorizations.campaignId, campaigns.id))
      .where(inArray(campaignAuthorizations.status, ['authorized', 'rejected']))
      .orderBy(desc(campaignAuthorizations.decidedAt))
      .limit(limit)
  }

  async getById(id: string) {
    const [record] = await this.ctx.db
      .select()
      .from(campaignAuthorizations)
      .where(eq(campaignAuthorizations.id, id))
    if (!record) {
      throw new NotFoundError('CampaignAuthorization', id)
    }
    return record
  }

  /**
   * Full review payload for one authorization: the frozen snapshot, each
   * variant rendered through the production email pipeline, and a staleness
   * check against the campaign's CURRENT payload hash.
   */
  async preview(id: string) {
    const record = await this.getById(id)
    const snapshot = record.snapshot as unknown as CampaignAuthorizationSnapshot
    const campaign = await this.getCampaign(record.campaignId)
    const variants = await loadCampaignVariants(this.ctx, record.campaignId)
    const currentHash = hashAuthorizationPayload(
      buildAuthorizationPayload(campaign, variants, resolveSenderIdentity()),
    )

    return {
      authorization: record,
      snapshot,
      rendered: snapshot.payload.variants.map((variant) => ({
        variantId: variant.variantId,
        language: variant.language,
        claimKeysUsed: variant.claimKeysUsed,
        ...renderSnapshotVariant(snapshot.payload, variant),
      })),
      currentHash,
      stale: currentHash !== record.payloadHash,
      campaignStatus: campaign.status,
    }
  }

  /**
   * Record the owner's decision. Rejection requires a note and also parks
   * the campaign itself (`status = rejected`). Authorization re-verifies the
   * live payload hash first — a campaign edited after the snapshot was taken
   * cannot be authorized (request a fresh review instead).
   */
  async decide(
    id: string,
    decision: AuthorizationDecision,
    opts: { decidedBy: string; decidedVia: string; note?: string },
  ) {
    const record = await this.getById(id)
    if (record.status !== 'pending') {
      throw new ValidationError(`Authorization is ${record.status}, not pending`)
    }
    const note = opts.note?.trim()
    if (decision === 'rejected' && !note) {
      throw new ValidationError('A note explaining the rejection is required')
    }

    if (decision === 'authorized') {
      const campaign = await this.getCampaign(record.campaignId)
      const variants = await loadCampaignVariants(this.ctx, record.campaignId)
      const currentHash = hashAuthorizationPayload(
        buildAuthorizationPayload(campaign, variants, resolveSenderIdentity()),
      )
      if (currentHash !== record.payloadHash) {
        throw new ValidationError(
          'Campaign changed after this authorization request was created. ' +
            'Request a fresh authorization to review the current content.',
        )
      }
    }

    const [updated] = await this.ctx.db
      .update(campaignAuthorizations)
      .set({
        status: decision,
        decidedBy: opts.decidedBy,
        decidedVia: opts.decidedVia,
        decisionNote: note ?? null,
        decidedAt: new Date(),
      })
      .where(eq(campaignAuthorizations.id, id))
      .returning()

    if (decision === 'rejected') {
      await this.ctx.db
        .update(campaigns)
        .set({ status: 'rejected' })
        .where(eq(campaigns.id, record.campaignId))
    }

    // biome-ignore lint/style/noNonNullAssertion: row existence checked above
    return updated!
  }
}

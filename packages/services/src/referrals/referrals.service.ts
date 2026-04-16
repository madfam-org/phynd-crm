import { isFeatureEnabled } from '@phyne/config/features'
import {
  campaigns,
  contacts,
  conversions,
  leads,
  pipelineStages,
  pipelines,
  referralCodes,
  referrals,
} from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import type { ServiceContext } from '../context'

const logger = createLogger('services:referrals')

const PRODUCT_PREFIXES: Record<string, string> = {
  karafiel: 'KRF',
  dhanam: 'DHN',
  selva: 'SLV',
}

const DEFAULT_PREFIX = 'MADFAM'

/**
 * Loose check for disposable/temporary email domains.
 * Not exhaustive — meant as a basic anti-abuse gate.
 */
const DISPOSABLE_EMAIL_REGEX =
  /^.+@(mailinator\.com|guerrillamail\.(com|de|net|org)|tempmail\.com|throwaway\.email|yopmail\.(com|fr)|trashmail\.(com|net)|fakeinbox\.com|sharklasers\.com|grr\.la|guerrillamailblock\.com|10minutemail\.com|temp-mail\.org|dispostable\.com)$/i

export class ReferralService {
  constructor(private readonly ctx: ServiceContext) {}

  /**
   * Generate a referral code for a user.
   * Format: {PREFIX}-{8 hex chars}
   */
  async generateCode(
    ownerJanuaId: string,
    ownerEmail: string | null,
    ownerName: string | null,
    sourceProduct: string,
  ) {
    const prefix = PRODUCT_PREFIXES[sourceProduct.toLowerCase()] ?? DEFAULT_PREFIX
    const random = randomBytes(5).toString('hex').toUpperCase().slice(0, 8)
    const code = `${prefix}-${random}`

    const [row] = await this.ctx.db
      .insert(referralCodes)
      .values({
        code,
        ownerJanuaId,
        ownerEmail,
        ownerName,
        sourceProduct,
      })
      .returning()

    logger.info({ code, ownerJanuaId, sourceProduct }, 'Referral code generated')

    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return row!
  }

  /**
   * Returns the existing active referral code for this owner, or null.
   */
  async getMyCode(ownerJanuaId: string) {
    const [row] = await this.ctx.db
      .select()
      .from(referralCodes)
      .where(and(eq(referralCodes.ownerJanuaId, ownerJanuaId), eq(referralCodes.isActive, true)))
      .orderBy(referralCodes.createdAt)
      .limit(1)

    return row ?? null
  }

  /**
   * Validate a referral code: checks active, not expired, under max uses.
   */
  async validateCode(code: string) {
    const [row] = await this.ctx.db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.code, code))
      .limit(1)

    if (!row) return null
    if (!row.isActive) return null
    if (row.expiresAt && row.expiresAt < new Date()) return null
    if (row.maxUses !== null && row.currentUses >= row.maxUses) return null

    return row
  }

  /**
   * Apply a referral: creates a referral record, contact, lead, and conversion
   * within a single transaction.
   *
   * Anti-abuse: blocks self-referrals and disposable email addresses.
   */
  async applyReferral(
    code: string,
    referredEmail: string,
    referredName: string | null,
    sourceProduct: string,
    targetProduct: string,
  ) {
    // Validate the code
    const codeRow = await this.validateCode(code)
    if (!codeRow) {
      throw new Error('Invalid or expired referral code')
    }

    // Anti-abuse: self-referral check
    if (codeRow.ownerJanuaId === this.ctx.auth.userId) {
      throw new Error('Self-referrals are not allowed')
    }

    // Anti-abuse: disposable email check
    if (DISPOSABLE_EMAIL_REGEX.test(referredEmail)) {
      throw new Error('Disposable email addresses are not allowed')
    }

    const result = await this.ctx.db.transaction(async (tx) => {
      // 1. Increment currentUses on the code
      await tx
        .update(referralCodes)
        .set({ currentUses: sql`${referralCodes.currentUses} + 1` })
        .where(eq(referralCodes.id, codeRow.id))

      // 2. Upsert contact by email
      const existingContacts = await tx
        .select()
        .from(contacts)
        .where(eq(contacts.email, referredEmail))
        .limit(1)

      let contactId: string
      if (existingContacts.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: checked length above
        contactId = existingContacts[0]!.id
      } else {
        const [newContact] = await tx
          .insert(contacts)
          .values({
            name: referredName ?? referredEmail.split('@')[0] ?? 'Referral',
            email: referredEmail,
            source: 'referral',
            status: 'active',
          })
          .returning()
        // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
        contactId = newContact!.id
      }

      // 3. Find default pipeline and first stage for lead creation
      const [defaultPipeline] = await tx
        .select()
        .from(pipelines)
        .where(eq(pipelines.isDefault, true))
        .limit(1)

      if (!defaultPipeline) {
        throw new Error('No default pipeline found for referral lead creation')
      }

      const [firstStage] = await tx
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.pipelineId, defaultPipeline.id))
        .orderBy(pipelineStages.position)
        .limit(1)

      if (!firstStage) {
        throw new Error('No stages found in default pipeline')
      }

      // 4. Create lead
      const [lead] = await tx
        .insert(leads)
        .values({
          contactId,
          pipelineId: defaultPipeline.id,
          stageId: firstStage.id,
          source: 'referral',
          status: 'open',
          score: 60,
        })
        .returning()
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
      const newLead = lead!

      // 5. Find referral campaign for conversion attribution
      const [referralCampaign] = await tx
        .select()
        .from(campaigns)
        .where(eq(campaigns.channel, 'referral'))
        .limit(1)

      // 6. Create conversion
      const [conversion] = await tx
        .insert(conversions)
        .values({
          type: 'referral_applied',
          contactId,
          leadId: newLead.id,
          campaignId: referralCampaign?.id,
          metadata: {
            referral_code: code,
            referrer_janua_id: codeRow.ownerJanuaId,
            source_product: sourceProduct,
            target_product: targetProduct,
          },
        })
        .returning()
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
      const newConversion = conversion!

      // 7. Create referral row
      const [referral] = await tx
        .insert(referrals)
        .values({
          referralCodeId: codeRow.id,
          referrerJanuaId: codeRow.ownerJanuaId,
          referredEmail,
          referredName,
          sourceProduct,
          targetProduct,
          status: 'applied',
          contactId,
          leadId: newLead.id,
          conversionId: newConversion.id,
          appliedAt: new Date(),
        })
        .returning()
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
      const newReferral = referral!

      return newReferral
    })

    logger.info(
      { referralId: result.id, code, referredEmail, sourceProduct, targetProduct },
      'Referral applied',
    )

    return result
  }

  /**
   * Convert a referral: transitions status to 'converted', records plan and revenue.
   * Returns the full referral data (with code info) for webhook dispatch.
   */
  async convertReferral(referralId: string, planId: string, revenueCents: number) {
    const [updated] = await this.ctx.db
      .update(referrals)
      .set({
        status: 'converted',
        planId,
        revenueCents,
        convertedAt: new Date(),
      })
      .where(eq(referrals.id, referralId))
      .returning()

    if (!updated) {
      throw new Error('Referral not found')
    }

    // Fetch joined code data for the webhook payload
    const [codeRow] = await this.ctx.db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.id, updated.referralCodeId))
      .limit(1)

    logger.info({ referralId, planId, revenueCents }, 'Referral converted')

    return {
      ...updated,
      code: codeRow ?? null,
    }
  }

  /**
   * Aggregate stats for a referrer: code count, referral counts by status,
   * and conversion rate.
   */
  async getStats(ownerJanuaId: string) {
    // Count codes
    const codeCountResult = await this.ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(referralCodes)
      .where(eq(referralCodes.ownerJanuaId, ownerJanuaId))

    const totalCodes = codeCountResult[0]?.count ?? 0

    // Count referrals by status
    const statusCounts = await this.ctx.db
      .select({
        status: referrals.status,
        count: sql<number>`count(*)::int`,
      })
      .from(referrals)
      .where(eq(referrals.referrerJanuaId, ownerJanuaId))
      .groupBy(referrals.status)

    const byStatus: Record<string, number> = {}
    let totalReferrals = 0
    let convertedCount = 0
    for (const row of statusCounts) {
      byStatus[row.status] = row.count
      totalReferrals += row.count
      if (row.status === 'converted') {
        convertedCount = row.count
      }
    }

    const conversionRate = totalReferrals > 0 ? convertedCount / totalReferrals : 0

    return {
      totalCodes,
      totalReferrals,
      byStatus,
      conversionRate,
    }
  }

  /**
   * Get a single referral by ID with joined code info.
   */
  async getById(referralId: string) {
    const [row] = await this.ctx.db
      .select()
      .from(referrals)
      .where(eq(referrals.id, referralId))
      .limit(1)

    if (!row) return null

    const [codeRow] = await this.ctx.db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.id, row.referralCodeId))
      .limit(1)

    return {
      ...row,
      code: codeRow ?? null,
    }
  }

  /**
   * Paginated list of all referrals (for admin views).
   */
  async list(pagination?: { cursor?: string; limit?: number }) {
    const limit = pagination?.limit ?? 50
    const conditions = []

    if (pagination?.cursor) {
      conditions.push(gt(referrals.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(referrals)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(referrals.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows

    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }
}

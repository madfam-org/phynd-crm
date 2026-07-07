import { campaignDraftVariants } from '@phynd/db/schema'
import { asc, eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import type { NormalizedDraftVariant } from './tulana-import.schema'

/**
 * Persists campaign draft copy variants handed off from Selva/Tulana so the
 * claims audit trail (`claim_keys_used`) survives the draft → needs_review →
 * approved flow. One row per variant; legacy string variants are stored with
 * format='legacy_string' and no claim keys.
 */
export class CampaignDraftVariantService {
  constructor(private readonly ctx: ServiceContext) {}

  async recordMany(input: {
    campaignId: string
    source: string
    variants: NormalizedDraftVariant[]
  }) {
    if (input.variants.length === 0) {
      return []
    }

    return this.ctx.db
      .insert(campaignDraftVariants)
      .values(
        input.variants.map((variant) => ({
          campaignId: input.campaignId,
          variantId: variant.variantId,
          format: variant.format,
          language: variant.language,
          subject: variant.subject,
          preheader: variant.preheader,
          body: variant.body,
          cta: variant.cta,
          claimKeysUsed: variant.claimKeysUsed,
          source: input.source,
        })),
      )
      .returning()
  }

  async listByCampaignId(campaignId: string) {
    return this.ctx.db
      .select()
      .from(campaignDraftVariants)
      .where(eq(campaignDraftVariants.campaignId, campaignId))
      .orderBy(asc(campaignDraftVariants.createdAt), asc(campaignDraftVariants.id))
  }
}

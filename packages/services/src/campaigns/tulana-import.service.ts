import { campaignImports, campaigns, skuCatalog } from '@phynd/db/schema'
import { eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { ConflictError } from '../errors'
import { CampaignDraftVariantService } from './campaign-draft-variant.service'
import {
  type TulanaCampaignImportInput,
  normalizeDraftVariant,
  tulanaCampaignImportSchema,
} from './tulana-import.schema'

export type TulanaImportResult = {
  campaignId: string
  skuKey: string
  deduplicated: boolean
  status: string
  draftVariantCount: number
}

export class TulanaCampaignImportService {
  constructor(private readonly ctx: ServiceContext) {}

  async importCampaign(raw: unknown): Promise<TulanaImportResult> {
    const input = tulanaCampaignImportSchema.parse(raw)
    const draftVariants = input.draft_variants.map(normalizeDraftVariant)

    const [existingImport] = await this.ctx.db
      .select()
      .from(campaignImports)
      .where(eq(campaignImports.idempotencyKey, input.idempotency_key))
      .limit(1)

    if (existingImport) {
      return {
        campaignId: existingImport.campaignId,
        skuKey: input.sku_key,
        deduplicated: true,
        status: 'draft_imported',
        draftVariantCount: 0,
      }
    }

    await this.ctx.db
      .insert(skuCatalog)
      .values({
        skuKey: input.sku_key,
        platform: input.platform,
        audience: input.audience,
        gaReadiness: input.ga_readiness,
        metadata: {
          value_prop: input.value_prop,
          proof_points: input.proof_points,
          commercial_ga_status: input.commercial_ga_status,
          commercial_ga_gate_version: input.commercial_ga_gate_version,
          commercial_ga_environment: input.commercial_ga_environment,
          commercial_ga_period: input.commercial_ga_period,
          audience_id: input.audience_id,
          consent_basis: input.consent_basis,
          human_approver_email: input.human_approver_email,
          gate_evidence: input.gate_evidence,
          money_path: input.money_path,
        },
      })
      .onConflictDoUpdate({
        target: skuCatalog.skuKey,
        set: {
          platform: input.platform,
          audience: input.audience,
          gaReadiness: input.ga_readiness,
          metadata: {
            value_prop: input.value_prop,
            proof_points: input.proof_points,
            commercial_ga_status: input.commercial_ga_status,
            commercial_ga_gate_version: input.commercial_ga_gate_version,
            commercial_ga_environment: input.commercial_ga_environment,
            commercial_ga_period: input.commercial_ga_period,
            audience_id: input.audience_id,
            consent_basis: input.consent_basis,
            human_approver_email: input.human_approver_email,
            gate_evidence: input.gate_evidence,
            money_path: input.money_path,
          },
          updatedAt: new Date(),
        },
      })

    const campaignName = `${input.platform} — ${input.sku_key}`
    const [campaign] = await this.ctx.db
      .insert(campaigns)
      .values({
        name: campaignName,
        description: input.value_prop,
        channel: 'other',
        status: 'needs_review',
        utmCampaign: input.sku_key,
        utmSource: input.source,
        utmMedium: input.orchestrator ?? 'selva',
        skuKey: input.sku_key,
        importSource: input.source,
        orchestrator: input.orchestrator,
        gaReadiness: input.ga_readiness,
        tulanaMetadata: {
          audience: input.audience,
          campaign_type: input.campaign_type,
          commercial_ga_status: input.commercial_ga_status,
          commercial_ga_gate_version: input.commercial_ga_gate_version,
          commercial_ga_environment: input.commercial_ga_environment,
          commercial_ga_period: input.commercial_ga_period,
          audience_id: input.audience_id,
          consent_basis: input.consent_basis,
          human_approver_email: input.human_approver_email,
          gate_evidence: input.gate_evidence,
          money_path: input.money_path,
          proof_points: input.proof_points,
          guardrails: input.guardrails,
          drafts: input.drafts,
          draft_variants: input.draft_variants,
        },
      })
      .returning()

    if (!campaign) {
      throw new ConflictError('Failed to create campaign from Tulana import')
    }

    // Persist structured/legacy draft variants so claim_keys_used survives
    // into the draft → approved review flow (campaign_draft_variants).
    if (draftVariants.length > 0) {
      const variantService = new CampaignDraftVariantService(this.ctx)
      await variantService.recordMany({
        campaignId: campaign.id,
        source: input.source,
        variants: draftVariants,
      })
    }

    await this.ctx.db.insert(campaignImports).values({
      idempotencyKey: input.idempotency_key,
      campaignId: campaign.id,
      source: input.source,
      orchestrator: input.orchestrator,
    })

    return {
      campaignId: campaign.id,
      skuKey: input.sku_key,
      deduplicated: false,
      status: campaign.status,
      draftVariantCount: draftVariants.length,
    }
  }

  static validatePayload(raw: unknown): TulanaCampaignImportInput {
    return tulanaCampaignImportSchema.parse(raw)
  }
}

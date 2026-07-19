import { beforeEach, describe, expect, it } from 'vitest'
import { CampaignDraftVariantService } from '../campaigns/campaign-draft-variant.service'
import { normalizeDraftVariant } from '../campaigns/tulana-import.schema'
import { createTestContext } from './helpers'

describe('normalizeDraftVariant', () => {
  it('normalizes a legacy string variant', () => {
    expect(normalizeDraftVariant('Plain draft text')).toEqual({
      variantId: null,
      format: 'legacy_string',
      language: null,
      subject: null,
      preheader: null,
      body: 'Plain draft text',
      cta: null,
      ctaUrl: null,
      claimKeysUsed: [],
    })
  })

  it('normalizes a structured variant preserving claim keys and preheader', () => {
    expect(
      normalizeDraftVariant({
        variant_id: 'v-1',
        language: 'es-MX',
        subject: 'Asunto',
        preheader: 'Vista previa',
        body: 'Cuerpo',
        cta: 'CTA',
        claim_keys_used: ['claim_a', 'claim_b'],
      }),
    ).toEqual({
      variantId: 'v-1',
      format: 'structured',
      language: 'es-MX',
      subject: 'Asunto',
      preheader: 'Vista previa',
      body: 'Cuerpo',
      cta: 'CTA',
      ctaUrl: null,
      claimKeysUsed: ['claim_a', 'claim_b'],
    })
  })

  it('defaults optional structured fields to null', () => {
    const normalized = normalizeDraftVariant({
      variant_id: 'v-2',
      language: 'en',
      subject: 'Subject',
      body: 'Body',
      claim_keys_used: ['claim_a'],
    })
    expect(normalized.preheader).toBeNull()
    expect(normalized.cta).toBeNull()
  })
})

describe('CampaignDraftVariantService', () => {
  let ctx: ReturnType<typeof createTestContext>

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('recordMany skips the insert for an empty variant list', async () => {
    const service = new CampaignDraftVariantService(ctx)
    const result = await service.recordMany({
      campaignId: 'camp-001',
      source: 'tulana',
      variants: [],
    })
    expect(result).toEqual([])
    expect(ctx.mockDb.insert).not.toHaveBeenCalled()
  })

  it('recordMany maps normalized variants to rows', async () => {
    const service = new CampaignDraftVariantService(ctx)
    ctx.mockDb._qb._result = [{ id: 'variant-row-1' }]

    await service.recordMany({
      campaignId: 'camp-001',
      source: 'selva',
      variants: [
        normalizeDraftVariant({
          variant_id: 'v-1',
          language: 'es-MX',
          subject: 'Asunto',
          preheader: 'Vista previa',
          body: 'Cuerpo',
          cta: 'CTA',
          claim_keys_used: ['claim_a'],
        }),
      ],
    })

    expect(ctx.mockDb.insert).toHaveBeenCalledTimes(1)
    const values = ctx.mockDb._qb.values.mock.calls[0]?.[0] as Record<string, unknown>[]
    expect(values).toHaveLength(1)
    expect(values[0]).toMatchObject({
      campaignId: 'camp-001',
      variantId: 'v-1',
      format: 'structured',
      preheader: 'Vista previa',
      claimKeysUsed: ['claim_a'],
      source: 'selva',
    })
  })

  it('listByCampaignId returns persisted rows', async () => {
    const service = new CampaignDraftVariantService(ctx)
    const rows = [{ id: 'variant-row-1', campaignId: 'camp-001', claimKeysUsed: ['claim_a'] }]
    ctx.mockDb._qb._result = rows

    const result = await service.listByCampaignId('camp-001')
    expect(result).toEqual(rows)
  })
})

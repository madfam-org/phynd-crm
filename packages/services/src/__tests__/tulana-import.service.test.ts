import { campaignDraftVariants } from '@phynd/db/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { tulanaCampaignImportSchema } from '../campaigns/tulana-import.schema'
import { TulanaCampaignImportService } from '../campaigns/tulana-import.service'
import { createTestContext } from './helpers'

const samplePayload = {
  idempotency_key: 'tulana-avala__issuer-20260529-v1',
  source: 'tulana',
  orchestrator: 'selva',
  sku_key: 'avala__issuer',
  platform: 'avala',
  audience: 'credential issuers',
  ga_readiness: 'near_ready' as const,
  campaign_type: 'text',
  value_prop: 'Evidence-backed positioning text',
  proof_points: [{ label: 'Comparator', value: 'Canvas Credentials' }],
  guardrails: { do_not_claim: ['GA if readiness is not ready'] },
  drafts: [{ channel: 'email', body: 'Hello from Tulana draft' }],
}

describe('TulanaCampaignImportService', () => {
  let ctx: ReturnType<typeof createTestContext>

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('creates sku + campaign on first import', async () => {
    const service = new TulanaCampaignImportService(ctx)
    const inserts: unknown[] = []
    const returningCampaign = {
      id: 'camp-001',
      status: 'needs_review',
    }

    ctx.mockDb._qb._result = []
    ctx.mockDb.insert = ((table: unknown) => ({
      values: (row: unknown) => {
        inserts.push({ table, row })
        return {
          onConflictDoUpdate: () => ({}),
          returning: async () => [returningCampaign],
        }
      },
    })) as unknown as typeof ctx.mockDb.insert

    const result = await service.importCampaign(samplePayload)

    expect(result.deduplicated).toBe(false)
    expect(result.campaignId).toBe('camp-001')
    expect(result.skuKey).toBe('avala__issuer')
    expect(inserts.length).toBeGreaterThanOrEqual(2)
  })

  it('accepts legacy string draft_variants (wire compat) and persists them', async () => {
    const service = new TulanaCampaignImportService(ctx)
    const inserts: { table: unknown; row: unknown }[] = []

    ctx.mockDb._qb._result = []
    ctx.mockDb.insert = ((table: unknown) => ({
      values: (row: unknown) => {
        inserts.push({ table, row })
        return {
          onConflictDoUpdate: () => ({}),
          returning: async () => [{ id: 'camp-002', status: 'needs_review' }],
        }
      },
    })) as unknown as typeof ctx.mockDb.insert

    const result = await service.importCampaign({
      ...samplePayload,
      idempotency_key: 'tulana-legacy-strings-v1',
      draft_variants: ['Plain legacy draft A', 'Plain legacy draft B'],
    })

    expect(result.draftVariantCount).toBe(2)
    const variantInsert = inserts.find((entry) => entry.table === campaignDraftVariants)
    expect(variantInsert).toBeDefined()
    const rows = variantInsert?.row as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      campaignId: 'camp-002',
      variantId: null,
      format: 'legacy_string',
      body: 'Plain legacy draft A',
      claimKeysUsed: [],
      source: 'tulana',
    })
  })

  it('persists structured draft_variants with claim_keys_used audit trail', async () => {
    const service = new TulanaCampaignImportService(ctx)
    const inserts: { table: unknown; row: unknown }[] = []

    ctx.mockDb._qb._result = []
    ctx.mockDb.insert = ((table: unknown) => ({
      values: (row: unknown) => {
        inserts.push({ table, row })
        return {
          onConflictDoUpdate: () => ({}),
          returning: async () => [{ id: 'camp-003', status: 'needs_review' }],
        }
      },
    })) as unknown as typeof ctx.mockDb.insert

    const result = await service.importCampaign({
      ...samplePayload,
      idempotency_key: 'tulana-structured-v1',
      draft_variants: [
        {
          variant_id: 'variant-uuid-1',
          language: 'es-MX',
          subject: 'Asunto de prueba',
          preheader: 'Texto de vista previa',
          body: 'Cuerpo del correo con claims verificados.',
          cta: 'Agenda una demo',
          claim_keys_used: ['issuer_verified_badges', 'ledger_export'],
        },
        // Mixed payload: structured + legacy string in the same handoff
        'Legacy tail variant',
      ],
    })

    expect(result.draftVariantCount).toBe(2)
    const variantInsert = inserts.find((entry) => entry.table === campaignDraftVariants)
    const rows = variantInsert?.row as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      campaignId: 'camp-003',
      variantId: 'variant-uuid-1',
      format: 'structured',
      language: 'es-MX',
      subject: 'Asunto de prueba',
      preheader: 'Texto de vista previa',
      body: 'Cuerpo del correo con claims verificados.',
      cta: 'Agenda una demo',
      claimKeysUsed: ['issuer_verified_badges', 'ledger_export'],
    })
    expect(rows[1]).toMatchObject({ format: 'legacy_string', body: 'Legacy tail variant' })

    // Wire snapshot also lands in tulana_metadata for the review dialog
    const campaignInsert = inserts.find(
      (entry) =>
        entry.table !== campaignDraftVariants &&
        (entry.row as Record<string, unknown>).tulanaMetadata !== undefined,
    )
    const metadata = (campaignInsert?.row as { tulanaMetadata: Record<string, unknown> })
      .tulanaMetadata
    expect(metadata.draft_variants).toHaveLength(2)
  })

  it('does not insert variant rows when draft_variants is absent (legacy payloads)', async () => {
    const service = new TulanaCampaignImportService(ctx)
    const inserts: { table: unknown; row: unknown }[] = []

    ctx.mockDb._qb._result = []
    ctx.mockDb.insert = ((table: unknown) => ({
      values: (row: unknown) => {
        inserts.push({ table, row })
        return {
          onConflictDoUpdate: () => ({}),
          returning: async () => [{ id: 'camp-004', status: 'needs_review' }],
        }
      },
    })) as unknown as typeof ctx.mockDb.insert

    const result = await service.importCampaign(samplePayload)

    expect(result.draftVariantCount).toBe(0)
    expect(inserts.some((entry) => entry.table === campaignDraftVariants)).toBe(false)
  })

  it('rejects structured variants missing required fields', () => {
    expect(() =>
      tulanaCampaignImportSchema.parse({
        ...samplePayload,
        draft_variants: [{ variant_id: 'v1', language: 'es-MX', subject: 'No body' }],
      }),
    ).toThrow()
  })

  it('returns existing campaign for duplicate idempotency_key', async () => {
    ctx.mockDb._qb._result = [
      {
        idempotencyKey: samplePayload.idempotency_key,
        campaignId: 'camp-existing',
        source: 'tulana',
      },
    ]

    const service = new TulanaCampaignImportService(ctx)
    const result = await service.importCampaign(samplePayload)

    expect(result.deduplicated).toBe(true)
    expect(result.campaignId).toBe('camp-existing')
  })
})

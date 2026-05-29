import { beforeEach, describe, expect, it } from 'vitest'
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

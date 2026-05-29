import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CampaignBuyerSignalService } from '../campaigns/campaign-buyer-signal.service'
import { createTestContext } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gte: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gte', col, val })),
}))

vi.mock('@phynd/db/schema', () => ({
  campaignBuyerSignals: {
    id: 'campaign_buyer_signals.id',
    dedupKey: 'campaign_buyer_signals.dedup_key',
    skuKey: 'campaign_buyer_signals.sku_key',
    occurredAt: 'campaign_buyer_signals.occurred_at',
  },
}))

describe('CampaignBuyerSignalService', () => {
  let service: CampaignBuyerSignalService
  let ctx: ReturnType<typeof createTestContext>

  beforeEach(() => {
    ctx = createTestContext()
    service = new CampaignBuyerSignalService(ctx)
    ctx.mockDb._qb._result = []
  })

  it('records a buyer signal row', async () => {
    let call = 0
    ctx.mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      call += 1
      const value = call === 1 ? [] : [{ id: 'signal-001' }]
      return Promise.resolve(value).then(resolve)
    })

    const result = await service.record({
      campaignId: 'camp-001',
      skuKey: 'avala__issuer',
      eventType: 'delivered',
      dedupKey: 'send:camp-001:contact-001',
    })
    expect(result.deduplicated).toBe(false)
    expect(ctx.mockDb.insert).toHaveBeenCalled()
  })

  it('deduplicates on dedup_key', async () => {
    ctx.mockDb._qb._result = [{ id: 'signal-existing' }]
    const result = await service.record({
      campaignId: 'camp-001',
      skuKey: 'avala__issuer',
      eventType: 'delivered',
      dedupKey: 'send:camp-001:contact-001',
    })
    expect(result.deduplicated).toBe(true)
    expect(ctx.mockDb.insert).not.toHaveBeenCalled()
  })

  it('exports PII-free Tulana rows', async () => {
    ctx.mockDb._qb._result = [
      {
        skuKey: 'avala__issuer',
        campaignId: 'camp-001',
        contactSegment: 'credential issuers',
        eventType: 'delivered',
        occurredAt: new Date('2026-05-28T12:00:00Z'),
        signalStrength: 'medium',
        notesRedacted: null,
      },
    ]

    const rows = await service.listForTulanaExport({ skuKey: 'avala__issuer' })
    expect(rows).toEqual([
      {
        sku_key: 'avala__issuer',
        campaign_id: 'camp-001',
        contact_segment: 'credential issuers',
        event_type: 'delivered',
        occurred_at: '2026-05-28T12:00:00.000Z',
        signal_strength: 'medium',
        notes_redacted: null,
      },
    ])
    expect(JSON.stringify(rows)).not.toMatch(/@/)
  })
})

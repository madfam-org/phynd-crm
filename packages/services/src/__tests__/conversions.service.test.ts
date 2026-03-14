import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversionsService } from '../conversions/conversions.service'
import {
  type MockDatabase,
  createTestContext,
  makeCampaign,
  makeConversion,
  makeOffer,
} from './helpers'

// ---------------------------------------------------------------------------
// Mock external modules
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      _tag: 'sql',
      strings,
      values,
    })),
    { join: vi.fn() },
  ),
}))

vi.mock('@phyne/db/schema', () => ({
  campaigns: {
    id: 'campaigns.id',
    offerId: 'campaigns.offerId',
  },
  conversions: {
    campaignId: 'conversions.campaignId',
    contactId: 'conversions.contactId',
    convertedAt: 'conversions.convertedAt',
    id: 'conversions.id',
    leadId: 'conversions.leadId',
    opportunityId: 'conversions.opportunityId',
    type: 'conversions.type',
    value: 'conversions.value',
  },
  offers: {
    currentRedemptions: 'offers.currentRedemptions',
    id: 'offers.id',
    status: 'offers.status',
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConversionsService', () => {
  let service: ConversionsService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new ConversionsService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // recordConversion()
  // -------------------------------------------------------------------------
  describe('recordConversion()', () => {
    it('inserts a conversion record and returns it', async () => {
      const conversion = makeConversion({
        id: 'conv-new',
        leadId: 'lead-001',
        type: 'visitor_to_lead',
      })
      mockDb._qb._result = [conversion]

      const result = await service.recordConversion({
        leadId: 'lead-001',
        type: 'visitor_to_lead',
      })

      expect(result).toEqual(conversion)
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('triggers auto-redemption when campaignId is provided', async () => {
      const conversion = makeConversion({
        campaignId: 'campaign-001',
        id: 'conv-new',
        type: 'visitor_to_lead',
      })
      const campaign = makeCampaign({ id: 'campaign-001', offerId: 'offer-001' })
      const offer = makeOffer({
        currentRedemptions: 5,
        id: 'offer-001',
        maxRedemptions: 100,
        status: 'active',
      })

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) {
          // recordConversion insert().returning()
          return Promise.resolve([conversion]).then(resolve)
        }
        if (callCount === 2) {
          // campaign lookup
          return Promise.resolve([campaign]).then(resolve)
        }
        if (callCount === 3) {
          // offer lookup inside transaction
          return Promise.resolve([offer]).then(resolve)
        }
        if (callCount === 4) {
          // offer update (increment redemptions)
          return Promise.resolve([{ ...offer, currentRedemptions: 6 }]).then(resolve)
        }
        if (callCount === 5) {
          // offer_redemption conversion insert
          return Promise.resolve([makeConversion({ type: 'offer_redemption' })]).then(resolve)
        }
        return Promise.resolve([]).then(resolve)
      })

      const result = await service.recordConversion({
        campaignId: 'campaign-001',
        type: 'visitor_to_lead',
      })

      expect(result).toEqual(conversion)
      // transaction was invoked for the auto-redemption
      expect(mockDb.transaction).toHaveBeenCalled()
    })

    it('does not trigger auto-redemption when no campaignId is provided', async () => {
      const conversion = makeConversion({ id: 'conv-new', type: 'visitor_to_lead' })
      mockDb._qb._result = [conversion]

      await service.recordConversion({ type: 'visitor_to_lead' })

      // transaction should not be called since no campaignId
      expect(mockDb.transaction).not.toHaveBeenCalled()
    })

    it('does not redeem when offer is not active', async () => {
      const conversion = makeConversion({
        campaignId: 'campaign-001',
        id: 'conv-new',
      })
      const campaign = makeCampaign({ id: 'campaign-001', offerId: 'offer-001' })
      const inactiveOffer = makeOffer({ id: 'offer-001', status: 'paused' })

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([conversion]).then(resolve)
        if (callCount === 2) return Promise.resolve([campaign]).then(resolve)
        // Inside transaction, offer is inactive
        if (callCount === 3) return Promise.resolve([inactiveOffer]).then(resolve)
        return Promise.resolve([]).then(resolve)
      })

      const result = await service.recordConversion({
        campaignId: 'campaign-001',
        type: 'visitor_to_lead',
      })

      expect(result).toEqual(conversion)
    })

    it('does not redeem when offer capacity is exhausted', async () => {
      const conversion = makeConversion({
        campaignId: 'campaign-001',
        id: 'conv-new',
      })
      const campaign = makeCampaign({ id: 'campaign-001', offerId: 'offer-001' })
      const exhaustedOffer = makeOffer({
        currentRedemptions: 100,
        id: 'offer-001',
        maxRedemptions: 100,
        status: 'active',
      })

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([conversion]).then(resolve)
        if (callCount === 2) return Promise.resolve([campaign]).then(resolve)
        if (callCount === 3) return Promise.resolve([exhaustedOffer]).then(resolve)
        return Promise.resolve([]).then(resolve)
      })

      const result = await service.recordConversion({
        campaignId: 'campaign-001',
        type: 'visitor_to_lead',
      })

      expect(result).toEqual(conversion)
    })

    it('does not redeem when campaign has no linked offer', async () => {
      const conversion = makeConversion({
        campaignId: 'campaign-001',
        id: 'conv-new',
      })
      const campaignNoOffer = makeCampaign({ id: 'campaign-001', offerId: null })

      let callCount = 0
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
        callCount++
        if (callCount === 1) return Promise.resolve([conversion]).then(resolve)
        if (callCount === 2) return Promise.resolve([campaignNoOffer]).then(resolve)
        return Promise.resolve([]).then(resolve)
      })

      const result = await service.recordConversion({
        campaignId: 'campaign-001',
        type: 'visitor_to_lead',
      })

      expect(result).toEqual(conversion)
      // Should not invoke transaction since campaign has no offer
      expect(mockDb.transaction).not.toHaveBeenCalled()
    })

    it('handles auto-redemption failure gracefully (non-blocking)', async () => {
      const conversion = makeConversion({
        campaignId: 'campaign-001',
        id: 'conv-new',
      })

      let callCount = 0
      mockDb._qb.then.mockImplementation(
        (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          callCount++
          if (callCount === 1) return Promise.resolve([conversion]).then(resolve)
          // Campaign lookup rejects — propagate via the onReject callback
          if (callCount === 2) {
            if (reject) {
              return Promise.reject(new Error('DB error')).then(resolve, reject)
            }
            return Promise.reject(new Error('DB error'))
          }
          return Promise.resolve([]).then(resolve)
        },
      )

      // Should not throw even though the auto-redemption fails
      const result = await service.recordConversion({
        campaignId: 'campaign-001',
        type: 'visitor_to_lead',
      })

      expect(result).toEqual(conversion)
    })
  })

  // -------------------------------------------------------------------------
  // getByEntity()
  // -------------------------------------------------------------------------
  describe('getByEntity()', () => {
    it('returns conversions for a contact', async () => {
      const items = [
        makeConversion({ contactId: 'contact-001', id: 'conv-1' }),
        makeConversion({ contactId: 'contact-001', id: 'conv-2' }),
      ]
      mockDb._qb._result = items

      const result = await service.getByEntity('contact', 'contact-001')

      expect(result).toHaveLength(2)
    })

    it('returns conversions for a lead', async () => {
      const items = [makeConversion({ id: 'conv-1', leadId: 'lead-001' })]
      mockDb._qb._result = items

      const result = await service.getByEntity('lead', 'lead-001')

      expect(result).toHaveLength(1)
    })

    it('returns conversions for an opportunity', async () => {
      const items = [makeConversion({ id: 'conv-1', opportunityId: 'opp-001' })]
      mockDb._qb._result = items

      const result = await service.getByEntity('opportunity', 'opp-001')

      expect(result).toHaveLength(1)
    })

    it('returns empty array when no conversions exist', async () => {
      mockDb._qb._result = []

      const result = await service.getByEntity('contact', 'nonexistent')

      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getFunnelMetrics()
  // -------------------------------------------------------------------------
  describe('getFunnelMetrics()', () => {
    it('returns aggregated funnel metrics', async () => {
      const metrics = {
        leadToOpportunity: 5,
        offerRedemptions: 1,
        opportunityToWon: 2,
        totalValue: 50000,
        visitorToLead: 10,
      }
      mockDb._qb._result = [metrics]

      const result = await service.getFunnelMetrics()

      expect(result).toEqual(metrics)
    })

    it('returns zeroed metrics when no conversions exist', async () => {
      mockDb._qb._result = [undefined]

      const result = await service.getFunnelMetrics()

      expect(result).toEqual({
        leadToOpportunity: 0,
        offerRedemptions: 0,
        opportunityToWon: 0,
        totalValue: 0,
        visitorToLead: 0,
      })
    })
  })
})

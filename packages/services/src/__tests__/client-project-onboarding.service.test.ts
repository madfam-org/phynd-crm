import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientProjectOnboardingService } from '../onboarding/client-project-onboarding.service'
import { createTestContext, makeContact, makeOpportunity, makeOrder, makeQuote } from './helpers'

vi.mock('@phyne/db/schema', () => ({
  contacts: { id: 'contacts.id' },
  conversions: { id: 'conversions.id' },
  engagementArtifacts: { id: 'engagementArtifacts.id' },
  engagementEvents: { id: 'engagementEvents.id' },
  engagements: { id: 'engagements.id' },
  opportunities: { id: 'opportunities.id' },
  orders: { id: 'orders.id' },
  quotes: { id: 'quotes.id' },
}))

function makeEngagement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eng-001',
    contactId: 'contact-001',
    opportunityId: 'opp-001',
    projectName: 'Selva Kiosk Twin',
    description: 'Physical kiosk plus digital twin',
    status: 'active',
    ownerId: 'test-user',
    deletedAt: null,
    createdAt: new Date('2026-05-07T10:00:00Z'),
    updatedAt: new Date('2026-05-07T10:00:00Z'),
    ...overrides,
  }
}

describe('ClientProjectOnboardingService', () => {
  let ctx: ReturnType<typeof createTestContext>
  let insertCalls: Array<{ table: unknown; values: Record<string, unknown> }>

  beforeEach(() => {
    ctx = createTestContext()
    insertCalls = []
  })

  it('creates a linked contact, opportunity, engagement, quote, and production order', async () => {
    const rows = [
      makeContact({ id: 'contact-001', name: 'Selva Office Client', ownerId: 'test-user' }),
      makeOpportunity({ id: 'opp-001', contactId: 'contact-001', ownerId: 'test-user' }),
      makeEngagement(),
      makeQuote({
        id: 'quote-001',
        contactId: 'contact-001',
        opportunityId: 'opp-001',
        quoteNumber: 'Q-2026-0007',
        totalAmount: '42000.00',
        currency: 'MXN',
        ownerId: 'test-user',
      }),
      makeOrder({
        id: 'order-001',
        contactId: 'contact-001',
        opportunityId: 'opp-001',
        quoteId: 'quote-001',
        orderNumber: 'ORD-2026-0007',
        totalAmount: '42000.00',
        currency: 'MXN',
        ownerId: 'test-user',
      }),
    ]
    installInsertMock(rows)

    const service = new ClientProjectOnboardingService(ctx)
    const result = await service.create({
      client: {
        name: 'Selva Office Client',
        email: 'client@example.com',
        company: 'Selva Buyer',
      },
      project: {
        name: 'Selva Kiosk Twin',
        description: 'Physical kiosk plus digital twin',
        kind: 'phygital',
        deliveryTracks: ['fabrication', 'digital_twin', 'kiosk'],
      },
      commercial: {
        pipelineId: 'pipeline-001',
        stageId: 'stage-001',
        amount: '42000.00',
        currency: 'mxn',
        quoteNumber: 'Q-2026-0007',
        createProductionOrder: true,
        orderNumber: 'ORD-2026-0007',
      },
      intakeSource: 'selva_office',
    })

    expect(result.contact.id).toBe('contact-001')
    expect(result.opportunity.contactId).toBe('contact-001')
    expect(result.engagement.opportunityId).toBe('opp-001')
    expect(result.quote.opportunityId).toBe('opp-001')
    expect(result.order?.quoteId).toBe('quote-001')

    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            name: 'Selva Office Client',
            email: 'client@example.com',
            ownerId: 'test-user',
          }),
        }),
        expect.objectContaining({
          values: expect.objectContaining({
            name: 'Selva Kiosk Twin',
            pipelineId: 'pipeline-001',
            stageId: 'stage-001',
            value: '42000.00',
          }),
        }),
        expect.objectContaining({
          values: expect.objectContaining({
            type: 'client_project_intake',
            contactId: 'contact-001',
            opportunityId: 'opp-001',
            metadata: expect.objectContaining({
              project_kind: 'phygital',
              delivery_tracks: ['fabrication', 'digital_twin', 'kiosk'],
              intake_source: 'selva_office',
            }),
          }),
        }),
        expect.objectContaining({
          values: expect.objectContaining({
            quoteNumber: 'Q-2026-0007',
            currency: 'MXN',
            status: 'draft',
          }),
        }),
        expect.objectContaining({
          values: expect.objectContaining({
            orderNumber: 'ORD-2026-0007',
            status: 'pending',
            quoteId: 'quote-001',
          }),
        }),
        expect.objectContaining({
          values: expect.objectContaining({
            eventType: 'system:intake_created',
            status: 'pending',
          }),
        }),
      ]),
    )
  })

  it('leaves production order null when the intake is quote-only', async () => {
    installInsertMock([
      makeContact({ id: 'contact-001' }),
      makeOpportunity({ id: 'opp-001' }),
      makeEngagement(),
      makeQuote({ id: 'quote-001' }),
    ])

    const service = new ClientProjectOnboardingService(ctx)
    const result = await service.create({
      client: { name: 'Digital Client' },
      project: {
        name: 'Digital Experience',
        kind: 'digital',
        deliveryTracks: ['digital_experience'],
      },
      commercial: {
        pipelineId: 'pipeline-001',
        stageId: 'stage-001',
        quoteNumber: 'Q-2026-0008',
      },
      intakeSource: 'crm',
    })

    expect(result.order).toBeNull()
    expect(insertCalls.some((call) => call.values.orderNumber === 'ORD-2026-0008')).toBe(false)
  })

  function installInsertMock(rows: Array<Record<string, unknown>>) {
    ctx.mockDb.insert = vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertCalls.push({ table, values })
        return {
          returning: vi.fn(async () => {
            const row = rows.shift()
            return row ? [row] : []
          }),
        }
      }),
    })) as unknown as typeof ctx.mockDb.insert
  }
})

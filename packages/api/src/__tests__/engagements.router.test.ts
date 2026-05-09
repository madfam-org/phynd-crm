import type { ServiceContext } from '@phynd/services/context'
import type { AuthContext } from '@phynd/types/auth'
import { describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { createCallerFactory } from '../trpc'

vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

function createMockAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    accessToken: 'tok_test',
    roles: ['admin'],
    scopes: ['*'],
    tenantId: 'madfam',
    userId: 'user-001',
    ...overrides,
  }
}

function createMockCtx(): ServiceContext & {
  db: ServiceContext['db'] & {
    _insertCalls: Array<Record<string, unknown>>
  }
} {
  const insertCalls: Array<Record<string, unknown>> = []
  const rows = [
    { id: 'contact-001', name: 'Selva Client' },
    { id: 'opp-001', contactId: 'contact-001', name: 'Selva Kiosk Twin' },
    {
      id: 'eng-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      projectName: 'Selva Kiosk Twin',
      status: 'active',
    },
    {
      id: 'quote-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      quoteNumber: 'Q-2026-0001',
      status: 'draft',
      currency: 'USD',
      totalAmount: '25000.00',
    },
    {
      id: 'order-001',
      contactId: 'contact-001',
      opportunityId: 'opp-001',
      quoteId: 'quote-001',
      orderNumber: 'ORD-2026-0001',
      status: 'pending',
    },
  ]

  const db = {
    _insertCalls: insertCalls,
    delete: vi.fn(),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertCalls.push(values)
        return {
          returning: vi.fn(async () => {
            const row = rows.shift()
            return row ? [row] : []
          }),
        }
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db)),
    update: vi.fn(),
  }

  return {
    auth: createMockAuth(),
    cache: {
      delete: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      invalidate: vi.fn(),
      set: vi.fn(),
    } as unknown as ServiceContext['cache'],
    db: db as unknown as ServiceContext['db'] & {
      _insertCalls: Array<Record<string, unknown>>
    },
    tenantId: 'madfam',
  }
}

describe('engagements router', () => {
  const createCaller = createCallerFactory(appRouter)

  it('onboards a client project through one protected mutation', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    const result = await caller.engagements.onboardClientProject({
      client: {
        name: 'Selva Client',
        email: 'client@example.com',
      },
      project: {
        name: 'Selva Kiosk Twin',
        kind: 'phygital',
        deliveryTracks: ['fabrication', 'digital_twin', 'kiosk'],
      },
      commercial: {
        pipelineId: 'pipeline-001',
        stageId: 'stage-001',
        amount: '25000.00',
        quoteNumber: 'Q-2026-0001',
        createProductionOrder: true,
        orderNumber: 'ORD-2026-0001',
      },
      intakeSource: 'crm',
    })

    expect(result.contact.id).toBe('contact-001')
    expect(result.opportunity.id).toBe('opp-001')
    expect(result.engagement.id).toBe('eng-001')
    expect(result.quote.id).toBe('quote-001')
    expect(result.order?.id).toBe('order-001')
    expect(ctx.db._insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'client_project_intake' }),
        expect.objectContaining({ eventType: 'system:intake_created' }),
      ]),
    )
  })

  it('rejects unsupported project kinds before writing', async () => {
    const ctx = createMockCtx()
    const caller = createCaller(ctx)

    await expect(
      caller.engagements.onboardClientProject({
        client: { name: 'Bad Kind' },
        project: {
          name: 'Unsupported',
          kind: 'service' as 'digital',
        },
        commercial: {
          pipelineId: 'pipeline-001',
          stageId: 'stage-001',
        },
      }),
    ).rejects.toThrow()

    expect(ctx.db._insertCalls).toHaveLength(0)
  })
})

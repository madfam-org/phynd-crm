import { describe, expect, it, vi } from 'vitest'

vi.mock('@phynd/db', () => ({ getDb: vi.fn() }))
vi.mock('@phynd/services', () => ({ LeadScoringService: vi.fn(), findDefaultOwner: vi.fn() }))
vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))
vi.mock('../lib/federation', () => ({ getCacheManager: vi.fn(() => ({})) }))

import {
  type BackfillLeadRow,
  planOwnersAndTasks,
  plannedAvalaAttribution,
} from '../processors/lead-intake-backfill'

function row(overrides: Partial<BackfillLeadRow>): BackfillLeadRow {
  return {
    id: 'lead-1',
    ownerId: null,
    contactOwnerId: null,
    status: 'new',
    hasFirstContactTask: false,
    name: 'Persona Ficticia',
    ...overrides,
  }
}

describe('planOwnersAndTasks', () => {
  it('gives an unowned lead the default owner and a task owned by that owner', () => {
    const plan = planOwnersAndTasks([row({})], 'user-default')
    expect([...plan.ownerUpdates]).toEqual([['lead-1', 'user-default']])
    expect(plan.tasks).toEqual([
      { leadId: 'lead-1', ownerId: 'user-default', name: 'Persona Ficticia' },
    ])
  })

  it("prefers the contact's owner, and keeps a lead's own owner", () => {
    const plan = planOwnersAndTasks(
      [
        row({ id: 'lead-1', contactOwnerId: 'user-contact' }),
        row({ id: 'lead-2', ownerId: 'user-kept' }),
      ],
      'user-default',
    )
    expect([...plan.ownerUpdates]).toEqual([['lead-1', 'user-contact']])
    expect(plan.tasks.map((task) => [task.leadId, task.ownerId])).toEqual([
      ['lead-1', 'user-contact'],
      ['lead-2', 'user-kept'],
    ])
  })

  it('opens no task for a lead that has one or is no longer new (idempotent)', () => {
    const plan = planOwnersAndTasks(
      [
        row({ id: 'lead-1', ownerId: 'u', hasFirstContactTask: true }),
        row({ id: 'lead-2', ownerId: 'u', status: 'contacted' }),
      ],
      'user-default',
    )
    expect(plan.ownerUpdates.size).toBe(0)
    expect(plan.tasks).toEqual([])
  })
})

describe('plannedAvalaAttribution', () => {
  const payload = {
    lead: { leadType: 'COMPANY', ecCode: 'EC0000', interests: ['dc3'], message: 'hola' },
    attribution: { intent: 'sales-request', sourcePage: '/contacto' },
  }

  it('adds the Avala keys the lead lacks', () => {
    expect(plannedAvalaAttribution({ utm_source: 'news' }, payload)).toEqual({
      utm_source: 'news',
      landing_page: '/contacto',
      lead_type: 'COMPANY',
      ec_code: 'EC0000',
      intent: 'sales-request',
      interests: ['dc3'],
    })
  })

  it('never overwrites a value already on the lead, and is a no-op the second time', () => {
    const current = { intent: 'request-access' }
    const first = plannedAvalaAttribution(current, payload)
    expect(first?.intent).toBe('request-access')
    expect(plannedAvalaAttribution(first, payload)).toBeNull()
  })
})

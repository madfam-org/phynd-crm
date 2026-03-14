import { describe, expect, it } from 'vitest'
import { ActivitiesService } from '../activities/activities.service'
import { ContactsService } from '../contacts/contacts.service'
import { LeadsService } from '../leads/leads.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { createTestContext, makeContact, makeLead, makeOpportunity } from './helpers'

describe('Owner-scoped queries', () => {
  describe('LeadsService.list with owner filter', () => {
    it('returns all leads when no filter is provided', async () => {
      const lead1 = makeLead({ id: 'lead-001', ownerId: 'user-a' })
      const lead2 = makeLead({ id: 'lead-002', ownerId: 'user-b' })
      const ctx = createTestContext([lead1, lead2])

      const service = new LeadsService(ctx)
      const result = await service.list()

      expect(result.items).toEqual([lead1, lead2])
    })

    it('filters by ownerId when provided', async () => {
      const lead1 = makeLead({ id: 'lead-001', ownerId: 'user-a' })
      const ctx = createTestContext([lead1])

      const service = new LeadsService(ctx)
      const result = await service.list(undefined, { ownerId: 'user-a' })

      expect(result.items).toEqual([lead1])
      expect(ctx.mockDb._qb.where).toHaveBeenCalled()
    })
  })

  describe('OpportunitiesService.list with owner filter', () => {
    it('returns all opportunities when no filter is provided', async () => {
      const opp1 = makeOpportunity({ id: 'opp-001', ownerId: 'user-a' })
      const ctx = createTestContext([opp1])

      const service = new OpportunitiesService(ctx)
      const result = await service.list()

      expect(result.items).toEqual([opp1])
    })

    it('filters by ownerId when provided', async () => {
      const opp1 = makeOpportunity({ id: 'opp-001', ownerId: 'user-a' })
      const ctx = createTestContext([opp1])

      const service = new OpportunitiesService(ctx)
      const result = await service.list(undefined, { ownerId: 'user-a' })

      expect(result.items).toEqual([opp1])
      expect(ctx.mockDb._qb.where).toHaveBeenCalled()
    })
  })

  describe('ContactsService.list with owner filter', () => {
    it('returns all contacts when no filter is provided', async () => {
      const contact = makeContact({ id: 'contact-001', ownerId: 'user-a' })
      const ctx = createTestContext([contact])

      const service = new ContactsService(ctx)
      const result = await service.list()

      expect(result.items).toEqual([contact])
    })

    it('filters by ownerId when provided', async () => {
      const contact = makeContact({ id: 'contact-001', ownerId: 'user-a' })
      const ctx = createTestContext([contact])

      const service = new ContactsService(ctx)
      const result = await service.list(undefined, { ownerId: 'user-a' })

      expect(result.items).toEqual([contact])
      expect(ctx.mockDb._qb.where).toHaveBeenCalled()
    })
  })

  describe('ActivitiesService.listRecent with owner filter', () => {
    it('returns all activities when no filter is provided', async () => {
      const activity = {
        id: 'act-001',
        type: 'call',
        title: 'Test call',
        ownerId: 'user-a',
        status: 'pending',
        entityType: 'lead',
        entityId: 'lead-001',
        createdAt: new Date('2025-01-15T10:00:00Z'),
        updatedAt: new Date('2025-01-15T10:00:00Z'),
        description: null,
        dueAt: null,
        completedAt: null,
      }
      const ctx = createTestContext([activity])

      const service = new ActivitiesService(ctx)
      const result = await service.listRecent()

      expect(result.items).toEqual([activity])
    })

    it('filters by ownerId when provided', async () => {
      const activity = {
        id: 'act-001',
        type: 'call',
        title: 'Test call',
        ownerId: 'user-a',
        status: 'pending',
        entityType: 'lead',
        entityId: 'lead-001',
        createdAt: new Date('2025-01-15T10:00:00Z'),
        updatedAt: new Date('2025-01-15T10:00:00Z'),
        description: null,
        dueAt: null,
        completedAt: null,
      }
      const ctx = createTestContext([activity])

      const service = new ActivitiesService(ctx)
      const result = await service.listRecent(undefined, { ownerId: 'user-a' })

      expect(result.items).toEqual([activity])
      expect(ctx.mockDb._qb.where).toHaveBeenCalled()
    })
  })
})

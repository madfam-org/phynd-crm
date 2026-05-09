import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VisitorTrackingService } from '../visitor-tracking/visitor-tracking.service'
import { type MockDatabase, createTestContext, makePageView, makeVisitorSession } from './helpers'

vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn(() => ({ _tag: 'sql' })),
}))

vi.mock('@phynd/db/schema', () => ({
  leads: {
    contactId: 'leads.contactId',
    id: 'leads.id',
  },
  visitorPageViews: {
    id: 'visitorPageViews.id',
    sessionId: 'visitorPageViews.sessionId',
    viewedAt: 'visitorPageViews.viewedAt',
  },
  visitorSessions: {
    contactId: 'visitorSessions.contactId',
    duration: 'visitorSessions.duration',
    endedAt: 'visitorSessions.endedAt',
    externalSessionId: 'visitorSessions.externalSessionId',
    id: 'visitorSessions.id',
    identified: 'visitorSessions.identified',
    pageViewCount: 'visitorSessions.pageViewCount',
    startedAt: 'visitorSessions.startedAt',
  },
}))

describe('VisitorTrackingService', () => {
  let service: VisitorTrackingService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new VisitorTrackingService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns visitor sessions', async () => {
      mockDb._qb._result = [makeVisitorSession()]
      const result = await service.list()
      expect(result).toHaveLength(1)
      expect(mockDb.select).toHaveBeenCalled()
    })

    it('returns empty when no sessions', async () => {
      mockDb._qb._result = []
      const result = await service.list()
      expect(result).toHaveLength(0)
    })

    it('filters by identified status', async () => {
      mockDb._qb._result = [makeVisitorSession({ identified: true })]
      const result = await service.list({ identified: true })
      expect(result).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getByContactId()
  // -------------------------------------------------------------------------
  describe('getByContactId()', () => {
    it('returns sessions for a contact', async () => {
      mockDb._qb._result = [makeVisitorSession({ contactId: 'contact-001', identified: true })]
      const result = await service.getByContactId('contact-001')
      expect(result).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty when contact has no sessions', async () => {
      mockDb._qb._result = []
      const result = await service.getByContactId('contact-none')
      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getAnonymous()
  // -------------------------------------------------------------------------
  describe('getAnonymous()', () => {
    it('returns anonymous sessions', async () => {
      mockDb._qb._result = [makeVisitorSession({ identified: false })]
      const result = await service.getAnonymous()
      expect(result).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty when no anonymous sessions', async () => {
      mockDb._qb._result = []
      const result = await service.getAnonymous()
      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // identifySession()
  // -------------------------------------------------------------------------
  describe('identifySession()', () => {
    it('links a session to a contact', async () => {
      const identified = makeVisitorSession({ contactId: 'contact-001', identified: true })
      mockDb._qb._result = [identified]
      const result = await service.identifySession('session-001', 'contact-001')
      expect(result).toEqual(identified)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null when session not found', async () => {
      mockDb._qb._result = []
      const result = await service.identifySession('nonexistent', 'contact-001')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // recordPageView()
  // -------------------------------------------------------------------------
  describe('recordPageView()', () => {
    it('records a page view', async () => {
      const pv = makePageView()
      mockDb._qb._result = [pv]
      const result = await service.recordPageView({
        sessionId: 'session-001',
        url: 'https://example.com/page',
      })
      expect(result).toBeDefined()
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getPageViews()
  // -------------------------------------------------------------------------
  describe('getPageViews()', () => {
    it('returns page views for a session', async () => {
      mockDb._qb._result = [makePageView(), makePageView({ id: 'pv-002', url: '/about' })]
      const result = await service.getPageViews('session-001')
      expect(result).toHaveLength(2)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns empty when session has no page views', async () => {
      mockDb._qb._result = []
      const result = await service.getPageViews('session-empty')
      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // getMetrics()
  // -------------------------------------------------------------------------
  describe('getMetrics()', () => {
    it('returns aggregate visitor metrics', async () => {
      const metrics = {
        anonymousSessions: 30,
        avgDuration: 120,
        identifiedSessions: 70,
        totalSessions: 100,
      }
      mockDb._qb._result = [metrics]
      const result = await service.getMetrics()
      expect(result).toEqual(metrics)
    })

    it('returns defaults when no sessions exist', async () => {
      mockDb._qb._result = [undefined]
      const result = await service.getMetrics()
      expect(result).toEqual({
        anonymousSessions: 0,
        avgDuration: 0,
        identifiedSessions: 0,
        totalSessions: 0,
      })
    })
  })
})

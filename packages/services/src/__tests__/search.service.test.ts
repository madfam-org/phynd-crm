import { contacts, leads, opportunities } from '@phynd/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchService } from '../search/search.service'
import {
  type MockDatabase,
  createTestContext,
  makeContact,
  makeLead,
  makeOpportunity,
} from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// drizzle-orm and the schema are real here (only the database is a mock), so
// the condition each query hands to `.where()` can be rendered to SQL and
// asserted on as text.

type SearchTable = typeof contacts | typeof leads | typeof opportunities

/** Renders the `.where()` condition of the query that selects from `table`. */
function renderedWhere(mockDb: MockDatabase, table: SearchTable) {
  // Each query calls `.from()` then `.where()` once, so the call indexes match.
  const index = mockDb._qb.from.mock.calls.findIndex(([selected]) => selected === table)
  expect(index).toBeGreaterThanOrEqual(0)
  const condition = mockDb._qb.where.mock.calls[index]?.[0] as SQL
  return new PgDialect().sqlToQuery(condition)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchService', () => {
  let service: SearchService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new SearchService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // search()
  // -------------------------------------------------------------------------
  describe('search()', () => {
    it('returns multi-entity results combining contacts, leads, and opportunities', async () => {
      const contactRow = makeContact({ id: 'c-1', name: 'Acme Corp' })
      const leadRow = makeLead({ id: 'l-1', source: 'acme', status: 'new' })
      const oppRow = makeOpportunity({ id: 'o-1', name: 'Acme Deal', value: '5000.00' })

      // SearchService calls Promise.all with 3 parallel db queries.
      // Each db.select() returns the same query builder, so all 3 resolve
      // to the same _result. We override _result to return all entity types
      // combined, then verify the mapping logic.
      // Since all 3 queries share the same mock builder, they all resolve
      // to the same result. We set _result to contact rows and verify
      // the service maps them correctly.
      mockDb._qb._result = [contactRow]

      const result = await service.search('acme')

      // All 3 queries resolve to [contactRow], so the service maps each as
      // contacts, leads, and opportunities respectively.
      expect(mockDb.select).toHaveBeenCalled()
      expect(result.length).toBeGreaterThan(0)
      // First batch should be contacts
      expect(result[0]?.entityType).toBe('contact')
      expect(result[0]?.title).toBe('Acme Corp')
    })

    it('returns empty results for empty query', async () => {
      mockDb._qb._result = []

      const result = await service.search('')

      expect(result).toHaveLength(0)
    })

    it('respects the limit option', async () => {
      // Create multiple contact results
      const rows = [
        makeContact({ id: 'c-1', name: 'Alpha' }),
        makeContact({ id: 'c-2', name: 'Beta' }),
        makeContact({ id: 'c-3', name: 'Gamma' }),
      ]
      mockDb._qb._result = rows

      const result = await service.search('test', { limit: 2 })

      // The service slices results to the limit at the end
      expect(result.length).toBeLessThanOrEqual(2)
    })

    it('maps contact fields correctly', async () => {
      const contactRow = makeContact({
        company: 'Widget Inc',
        id: 'c-1',
        name: 'Jane Smith',
      })
      mockDb._qb._result = [contactRow]

      const result = await service.search('jane')

      const contactResult = result.find((r) => r.entityType === 'contact')
      expect(contactResult).toBeDefined()
      expect(contactResult?.title).toBe('Jane Smith')
      expect(contactResult?.subtitle).toBe('Widget Inc')
    })

    it('handles null values in opportunity value field', async () => {
      const oppRow = makeOpportunity({ id: 'o-1', name: 'No Value Deal', value: null })
      mockDb._qb._result = [oppRow]

      const result = await service.search('deal')

      // The opportunity mapping produces subtitle: null when value is null
      const oppResult = result.find((r) => r.entityType === 'opportunity')
      if (oppResult) {
        expect(oppResult.subtitle).toBeNull()
      }
    })

    it('calls limit on query builder', async () => {
      mockDb._qb._result = []

      await service.search('test', { limit: 5 })

      expect(mockDb._qb.limit).toHaveBeenCalled()
    })

    it.each([
      ['contacts', contacts],
      ['leads', leads],
      ['opportunities', opportunities],
    ] as const)('applies the soft-delete filter to the %s query', async (name, table) => {
      mockDb._qb._result = []

      await service.search('acme')

      const { sql } = renderedWhere(mockDb, table)
      expect(sql).toContain(`"${name}"."deleted_at" is null`)
    })

    it('requires the soft-delete filter together with the contact text match', async () => {
      mockDb._qb._result = []

      await service.search('acme')

      // The filter is ANDed with the whole group of text matches; it is not
      // one more alternative inside the OR.
      const { sql, params } = renderedWhere(mockDb, contacts)
      expect(sql).toBe(
        '(("contacts"."name" ilike $1 or "contacts"."email" ilike $2 or "contacts"."company" ilike $3) and "contacts"."deleted_at" is null)',
      )
      expect(params).toEqual(['%acme%', '%acme%', '%acme%'])
    })

    it.each([
      ['a percent sign', '100%', '%100\\%%'],
      ['an underscore', 'a_b', '%a\\_b%'],
      ['a backslash', 'a\\b', '%a\\\\b%'],
    ])('matches %s in the search text literally, in every query', async (_name, text, pattern) => {
      mockDb._qb._result = []

      await service.search(text)

      expect(renderedWhere(mockDb, contacts).params).toEqual([pattern, pattern, pattern])
      expect(renderedWhere(mockDb, leads).params).toEqual([pattern])
      expect(renderedWhere(mockDb, opportunities).params).toEqual([pattern])
    })
  })
})

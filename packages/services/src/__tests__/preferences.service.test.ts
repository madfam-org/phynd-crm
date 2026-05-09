import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreferencesService } from '../preferences/preferences.service'
import { type MockDatabase, createTestContext, makePreference } from './helpers'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
}))

vi.mock('@phynd/db/schema', () => ({
  roleViewPreferences: {
    id: 'roleViewPreferences.id',
    role: 'roleViewPreferences.role',
  },
}))

describe('PreferencesService', () => {
  let service: PreferencesService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new PreferencesService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // getForRole()
  // -------------------------------------------------------------------------
  describe('getForRole()', () => {
    it('returns preferences for a role', async () => {
      const pref = makePreference({ role: 'admin' })
      mockDb._qb._result = [pref]
      const result = await service.getForRole('admin')
      expect(result).toEqual(pref)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('returns null when no preferences set', async () => {
      mockDb._qb._result = []
      const result = await service.getForRole('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // upsert()
  // -------------------------------------------------------------------------
  describe('upsert()', () => {
    it('creates or updates preferences', async () => {
      const pref = makePreference({ defaultTab: 'billing', role: 'finance' })
      mockDb._qb._result = [pref]
      const result = await service.upsert({
        defaultTab: 'billing',
        panelOrder: ['billing', 'identity'],
        role: 'finance',
      })
      expect(result).toBeDefined()
      expect(mockDb.insert).toHaveBeenCalled()
      expect(mockDb._qb.onConflictDoUpdate).toHaveBeenCalled()
    })

    it('preserves existing data on conflict', async () => {
      const existing = makePreference({ role: 'admin' })
      mockDb._qb._result = [existing]
      const result = await service.upsert({
        defaultTab: 'identity',
        panelOrder: ['identity', 'billing'],
        role: 'admin',
      })
      expect(result).toEqual(existing)
      expect(mockDb._qb.onConflictDoUpdate).toHaveBeenCalled()
    })
  })
})

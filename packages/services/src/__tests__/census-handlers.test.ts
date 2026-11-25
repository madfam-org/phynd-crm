import { describe, expect, it, vi } from 'vitest'
import type { CensusPickHandoff } from '../census/census-event-schema'
import { createCensusEventHandlers } from '../census/census-handlers'

const pick = { eventId: 'evt' } as CensusPickHandoff

function handlers(env: Record<string, string | undefined>) {
  const getDb = vi.fn(() => {
    throw new Error('getDb must not be reached')
  })
  return {
    getDb,
    handlers: createCensusEventHandlers({
      // biome-ignore lint/suspicious/noExplicitAny: never called in these tests
      getDb: getDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: never used in these tests
      cache: {} as any,
      logger: { warn: vi.fn() },
      defaultTenantId: 'house',
      env,
    }),
  }
}

describe('createCensusEventHandlers', () => {
  it.each([
    ['the configured default tenant', 'house', { DATABASE_URL_HOUSE: 'postgresql://x/y' }],
    ['the built-in default tenant', 'madfam', { DATABASE_URL_MADFAM: 'postgresql://x/y' }],
    ['a tenant without its own database URL', 'agency_a', {}],
    ['a tenant with a blank database URL', 'agency_a', { DATABASE_URL_AGENCY_A: '  ' }],
  ])('refuses %s before any database is opened', async (_label, tenant, env) => {
    const { getDb, handlers: h } = handlers(env)
    await expect(h.pickHandedOff(tenant, pick)).rejects.toThrow(/no database of its own/)
    await expect(
      h.optOutCompleted(tenant, {
        eventId: 'e',
        platform: 'youtube',
        externalId: 'x',
        observedAt: 'y',
      }),
    ).rejects.toThrow(/no database of its own/)
    expect(getDb).not.toHaveBeenCalled()
  })
})

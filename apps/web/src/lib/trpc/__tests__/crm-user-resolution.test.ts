/**
 * Janua sign-in → request context → CRM user, end to end.
 *
 * A real Auth.js sign-in against the in-process Janua stub produces the
 * session; `resolveAuthContext` resolves the CRM user through
 * `users.external_janua_id` (the database is an in-memory fake that decodes
 * the real Drizzle where-clause); the real tRPC router then runs FK writes.
 */
import { CRM_USER_NOT_LINKED_MESSAGE } from '@phynd/types/auth'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type StubUser,
  createJanuaSignInHarness,
  readSession,
} from '@/lib/auth/__tests__/janua-stub'

const { authMock, fakeDb } = vi.hoisted(() => {
  /** users.external_janua_id → users.id */
  const links = new Map<string, string>()
  const inserted: Array<Record<string, unknown>> = []
  let lookups = 0
  let dialect: { sqlToQuery: (s: unknown) => { params: unknown[] } } | null = null

  function chain(result: () => unknown[]) {
    const q: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'limit', 'orderBy', 'returning']) {
      q[m] = (arg?: unknown) => {
        if (m === 'where') q._where = arg
        return q
      }
    }
    Object.defineProperty(q, 'then', {
      value: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        try {
          resolve(result.call(q))
        } catch (e) {
          reject(e)
        }
      },
    })
    return q
  }

  const fakeDb = {
    links,
    inserted,
    get lookups() {
      return lookups
    },
    setDialect(d: typeof dialect) {
      dialect = d
    },
    reset() {
      links.clear()
      inserted.length = 0
      lookups = 0
    },
    select() {
      return chain(function (this: { _where?: unknown }) {
        lookups++
        const sub = dialect?.sqlToQuery(this._where).params[0] as string
        const id = links.get(sub)
        return id ? [{ id }] : []
      })
    },
    insert() {
      let row: Record<string, unknown> = {}
      const q = chain(() => [{ id: `row-${inserted.length}`, ...row }])
      q.values = (v: Record<string, unknown>) => {
        row = v
        inserted.push(v)
        return q
      }
      return q
    },
  }
  return { authMock: vi.fn(), fakeDb }
})

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@phynd/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@phynd/db')>()),
  getDb: () => fakeDb,
}))
vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: () => ({}),
  getFederationClients: () => ({}),
  getHealthChecker: () => ({}),
}))

import { crmUserResolver } from '@phynd/services/identity'
import {
  createAppContext,
  createAppContextFromRequest,
  createCaller,
  resolveAuthContext,
} from '../request-context'

const alice: StubUser = {
  sub: '5b0f2c1e-7a7d-4c1e-9d55-2f3b8f6a9c01',
  email: 'alice@example.com',
  roles: ['sales_rep'],
  scope: 'openid',
}
const ALICE_CRM_ID = '0d6f9e2a-1111-4b2c-8c3d-00000000a11c'
const activity = {
  type: 'call' as const,
  title: 'Intro call',
  entityType: 'lead' as const,
  entityId: '00000000-0000-4000-8000-000000000001',
}

let harness: Awaited<ReturnType<typeof createJanuaSignInHarness>>

beforeAll(async () => {
  const dialect = new PgDialect()
  fakeDb.setDialect({ sqlToQuery: (where: unknown) => dialect.sqlToQuery(where as SQL) })
  harness = await createJanuaSignInHarness()
})

beforeEach(async () => {
  fakeDb.reset()
  crmUserResolver.clear()
  // The session a browser would get after signing in at Janua.
  const session = await readSession(harness.handlers, await harness.signIn(alice))
  authMock.mockResolvedValue({ ...session, accessToken: 'janua-access-token' })
})

afterEach(() => {
  authMock.mockReset()
})

describe('linked Janua user', () => {
  beforeEach(() => {
    fakeDb.links.set(alice.sub, ALICE_CRM_ID)
  })

  it('exposes the Janua subject and the linked CRM user id', async () => {
    const auth = await resolveAuthContext(new Headers({ host: 'crm.madfam.io' }))

    expect(auth.userId).toBe(alice.sub)
    expect(auth.januaSub).toBe(alice.sub)
    expect(auth.crmUserId).toBe(ALICE_CRM_ID)
  })

  it('writes activities.owner_id = users.id, not the Janua subject', async () => {
    const auth = await resolveAuthContext(new Headers({ host: 'crm.madfam.io' }))

    await createCaller(createAppContext(auth)).activities.create(activity)

    expect(fakeDb.inserted).toHaveLength(1)
    expect(fakeDb.inserted[0]?.ownerId).toBe(ALICE_CRM_ID)
  })

  it('looks the link up once and serves later requests from the cache', async () => {
    await resolveAuthContext(new Headers())
    await resolveAuthContext(new Headers())
    await resolveAuthContext(new Headers())

    expect(fakeDb.lookups).toBe(1)
  })
})

describe('unlinked Janua user', () => {
  it('has crmUserId = null and keeps the Janua subject as userId', async () => {
    const auth = await resolveAuthContext(new Headers())

    expect(auth.januaSub).toBe(alice.sub)
    expect(auth.crmUserId).toBeNull()
  })

  it('gets the typed not-linked error on an FK write, and nothing is written', async () => {
    const auth = await resolveAuthContext(new Headers())

    await expect(
      createCaller(createAppContext(auth)).activities.create(activity),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: CRM_USER_NOT_LINKED_MESSAGE })
    expect(fakeDb.inserted).toHaveLength(0)
  })

  it('is picked up right after an admin links the account in this process', async () => {
    const before = await resolveAuthContext(new Headers())
    expect(before.crmUserId).toBeNull()

    fakeDb.links.set(alice.sub, ALICE_CRM_ID)
    crmUserResolver.invalidate('madfam', alice.sub) // what users.linkJanua does

    const after = await resolveAuthContext(new Headers())
    expect(after.crmUserId).toBe(ALICE_CRM_ID)
  })
})

describe('non-Janua principals', () => {
  it('a federation service token keeps service:selva and never looks up a CRM user', async () => {
    vi.stubEnv('FEDERATION_API_TOKEN', 'svc-token')
    vi.resetModules()
    const mod = await import('../request-context')
    const ctx = await mod.createAppContextFromRequest(
      new Request('https://crm.madfam.io/api/trpc/leads.list', {
        headers: { authorization: 'Bearer svc-token' },
      }),
      'trpc',
    )
    vi.unstubAllEnvs()

    expect(ctx.auth.userId).toBe('service:selva')
    expect(ctx.auth.januaSub).toBeUndefined()
    expect(ctx.auth.crmUserId).toBeUndefined()
    expect(fakeDb.lookups).toBe(0)
  })

  it('no session means no lookup', async () => {
    authMock.mockResolvedValue(null)
    const ctx = await createAppContextFromRequest(new Request('https://crm.madfam.io/'), 'trpc')

    expect(ctx.auth.userId).toBe('')
    expect(fakeDb.lookups).toBe(0)
  })
})

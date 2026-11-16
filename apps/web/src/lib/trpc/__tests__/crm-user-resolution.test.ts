/**
 * Janua sign-in → request context → CRM user, end to end.
 *
 * A real Auth.js sign-in against the in-process Janua stub produces the
 * session; `resolveAuthContext` resolves the CRM user through
 * `users.external_janua_id` (the database is an in-memory fake that decodes
 * the real Drizzle where-clause); the real tRPC router then runs FK writes.
 */
import { CRM_USER_NOT_LINKED_MESSAGE } from '@phynd/types/auth'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type StubUser,
  createJanuaSignInHarness,
  readSession,
} from '@/lib/auth/__tests__/janua-stub'
import { type FakeUsersDb, createFakeUsersDb } from './fake-users-db'

const { authMock, db } = vi.hoisted(() => ({
  authMock: vi.fn(),
  db: { current: null as FakeUsersDb | null },
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@phynd/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@phynd/db')>()),
  getDb: () => db.current,
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

const fakeDb = createFakeUsersDb()
db.current = fakeDb

beforeAll(async () => {
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
    fakeDb.link(alice.sub, ALICE_CRM_ID)
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

describe('unlinked Janua user (staff gate)', () => {
  it('is treated as signed out: no user id, no Janua subject', async () => {
    const auth = await resolveAuthContext(new Headers())

    expect(auth.userId).toBe('')
    expect(auth.januaSub).toBeUndefined()
    expect(auth.crmUserId).toBeUndefined()
  })

  it('cannot list or write, and nothing is written', async () => {
    const caller = createCaller(createAppContext(await resolveAuthContext(new Headers())))

    await expect(caller.contacts.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.activities.create(activity)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    expect(fakeDb.inserted).toHaveLength(0)
  })

  it('is let in right after an admin links the account in this process', async () => {
    const before = await resolveAuthContext(new Headers())
    expect(before.userId).toBe('')

    fakeDb.link(alice.sub, ALICE_CRM_ID)
    crmUserResolver.invalidate('madfam', alice.sub) // what users.linkJanua does

    const after = await resolveAuthContext(new Headers())
    expect(after.userId).toBe(alice.sub)
    expect(after.crmUserId).toBe(ALICE_CRM_ID)
  })
})

describe('unlinked Janua user with PHYND_ALLOW_UNLINKED_SIGNIN=true (break-glass)', () => {
  beforeEach(() => {
    vi.stubEnv('PHYND_ALLOW_UNLINKED_SIGNIN', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps the Janua subject as userId with crmUserId = null', async () => {
    const auth = await resolveAuthContext(new Headers())

    expect(auth.userId).toBe(alice.sub)
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
})

describe('first-admin bootstrap (PHYND_BOOTSTRAP_ADMIN_SUBS)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('provisions a linked CRM admin for a listed, unlinked subject', async () => {
    vi.stubEnv('PHYND_BOOTSTRAP_ADMIN_SUBS', `someone-else, ${alice.sub}`)

    const auth = await resolveAuthContext(new Headers())

    expect(auth.userId).toBe(alice.sub)
    // The inserted row's id, as the fake database returns it.
    expect(auth.crmUserId).toMatch(/^row-\d+$/)
    expect(fakeDb.inserted).toEqual([
      expect.objectContaining({ email: alice.email, role: 'admin', externalJanuaId: alice.sub }),
    ])
  })

  it('leaves an unlisted, unlinked subject signed out and writes nothing', async () => {
    vi.stubEnv('PHYND_BOOTSTRAP_ADMIN_SUBS', 'someone-else')

    const auth = await resolveAuthContext(new Headers())

    expect(auth.userId).toBe('')
    expect(fakeDb.inserted).toHaveLength(0)
  })

  it('does nothing for a listed subject that is already linked', async () => {
    vi.stubEnv('PHYND_BOOTSTRAP_ADMIN_SUBS', alice.sub)
    fakeDb.link(alice.sub, ALICE_CRM_ID)

    const auth = await resolveAuthContext(new Headers())

    expect(auth.crmUserId).toBe(ALICE_CRM_ID)
    expect(fakeDb.inserted).toHaveLength(0)
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

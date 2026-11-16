/**
 * Staff authorization comes from the linked CRM user's role, end to end.
 *
 * A real Auth.js sign-in against the in-process Janua stub produces the
 * session (with whatever roles Janua puts in its token); `resolveAuthContext`
 * resolves the CRM user and its role from an in-memory users table; the real
 * tRPC router enforces `requireRole`. Also covers the staff bootstrap
 * (`PHYND_BOOTSTRAP_STAFF`, subjects only) and the last-admin guard.
 */
import { resetFeatureFlags, setFeatureFlags } from '@phynd/config/features'
import { shouldMaskPiiForAgent } from '@phynd/services'
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
  SERVICE_AUTH_SCOPES,
  clearBootstrapRefusals,
  createAppContext,
  createAppContextFromRequest,
  createCaller,
  resolveAuthContext,
} from '../request-context'

const fakeDb = createFakeUsersDb()
db.current = fakeDb

// Fictional accounts. Janua puts `admin` in every token on purpose: it must
// not grant anything.
const ana: StubUser = {
  sub: '11111111-aaaa-4aaa-8aaa-000000000001',
  email: 'ana.ejemplo@example.test',
  roles: ['admin'],
  scope: 'openid',
}
const beto: StubUser = {
  sub: '22222222-bbbb-4bbb-8bbb-000000000002',
  email: 'beto.ejemplo@example.test',
  roles: ['admin', 'service'],
  scope: 'openid',
}
const ANA_ID = '0d6f9e2a-1111-4b2c-8c3d-0000000000a1'
const BETO_ID = '0d6f9e2a-1111-4b2c-8c3d-0000000000b2'
const activity = {
  type: 'call' as const,
  title: 'Intro call',
  entityType: 'lead' as const,
  entityId: '00000000-0000-4000-8000-000000000001',
}

let harness: Awaited<ReturnType<typeof createJanuaSignInHarness>>
const sessions = new Map<string, unknown>()

/** Makes `auth()` return the session a browser gets after signing in as `user`. */
async function signedInAs(user: StubUser) {
  const key = JSON.stringify(user)
  if (!sessions.has(key)) {
    const session = await readSession(harness.handlers, await harness.signIn(user))
    sessions.set(key, { ...session, accessToken: 'janua-access-token' })
  }
  authMock.mockResolvedValue(sessions.get(key))
}

async function callerFor(user: StubUser) {
  await signedInAs(user)
  const auth = await resolveAuthContext(new Headers())
  return { auth, caller: createCaller(createAppContext(auth)) }
}

beforeAll(async () => {
  harness = await createJanuaSignInHarness()
})

beforeEach(() => {
  fakeDb.reset()
  crmUserResolver.clear()
  clearBootstrapRefusals()
})

afterEach(() => {
  authMock.mockReset()
  vi.unstubAllEnvs()
  resetFeatureFlags()
})

describe('a staff session has exactly the linked CRM user role', () => {
  it('ignores the token roles: CRM viewer with Janua admin is a viewer', async () => {
    fakeDb.link(ana.sub, ANA_ID, 'viewer')
    const { auth, caller } = await callerFor(ana)

    expect(auth.roles).toEqual(['viewer'])
    await expect(caller.users.list()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('a CRM admin manages users', async () => {
    fakeDb.link(ana.sub, ANA_ID, 'admin')
    fakeDb.link(beto.sub, BETO_ID, 'viewer')
    const { auth, caller } = await callerFor(ana)

    expect(auth.roles).toEqual(['admin'])
    const list = await caller.users.list()
    expect(list.items.map((u) => u.id).sort()).toEqual([ANA_ID, BETO_ID].sort())
    await caller.users.update({ id: BETO_ID, role: 'manager' })
    expect(fakeDb.byId(BETO_ID)?.role).toBe('manager')
  })

  it('a CRM manager cannot manage users or remove a suppression (admin-only)', async () => {
    fakeDb.link(ana.sub, ANA_ID, 'manager')
    fakeDb.link(beto.sub, BETO_ID, 'viewer')
    const { auth, caller } = await callerFor(ana)

    expect(auth.roles).toEqual(['manager'])
    await expect(caller.users.list()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(caller.users.update({ id: BETO_ID, role: 'admin' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(caller.users.linkJanua({ id: BETO_ID, januaSub: 'x-1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      caller.consent.suppressionRemove({ id: '00000000-0000-4000-8000-0000000000ff' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(fakeDb.byId(BETO_ID)?.role).toBe('viewer')
  })

  it('a CRM manager does everything that is not admin-only', async () => {
    fakeDb.link(ana.sub, ANA_ID, 'manager')
    const { caller } = await callerFor(ana)

    await caller.activities.create(activity)
    await expect(caller.users.me()).resolves.toMatchObject({ crmUserId: ANA_ID, linked: true })
    expect(fakeDb.inserted).toHaveLength(1)
  })

  it('a role outside the staff roles grants nothing (not even service)', async () => {
    fakeDb.link(ana.sub, ANA_ID, 'service')
    const { auth } = await callerFor(ana)

    expect(auth.userId).toBe(ana.sub)
    expect(auth.roles).toEqual([])
  })

  it('masking follows the CRM role: a Janua `service` role does not make staff a service', async () => {
    setFeatureFlags({ piiMasking: true })
    fakeDb.link(beto.sub, BETO_ID, 'sales_rep')
    const { auth } = await callerFor(beto)

    expect(auth.roles).toEqual(['sales_rep'])
    expect(shouldMaskPiiForAgent(auth)).toBe(false)
  })

  it('an unlinked break-glass session has no roles', async () => {
    vi.stubEnv('PHYND_ALLOW_UNLINKED_SIGNIN', 'true')
    const { auth, caller } = await callerFor(ana)

    expect(auth.userId).toBe(ana.sub)
    expect(auth.crmUserId).toBeNull()
    expect(auth.roles).toEqual([])
    await expect(caller.users.list()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('role and link changes through the users router', () => {
  it("apply to the affected user's next request in this process (cache invalidated)", async () => {
    fakeDb.link(ana.sub, ANA_ID, 'admin')
    fakeDb.link(beto.sub, BETO_ID, 'manager')
    expect((await callerFor(beto)).auth.roles).toEqual(['manager'])
    const lookups = fakeDb.lookups
    expect((await callerFor(beto)).auth.roles).toEqual(['manager'])
    expect(fakeDb.lookups).toBe(lookups) // served from the cache

    const { caller: admin } = await callerFor(ana)
    await admin.users.update({ id: BETO_ID, role: 'viewer' })
    expect((await callerFor(beto)).auth.roles).toEqual(['viewer'])

    await admin.users.unlinkJanua({ id: BETO_ID })
    expect((await callerFor(beto)).auth.userId).toBe('')
  })
})

describe('service principals are unchanged', () => {
  it('the federation bearer keeps roles [service] and its scopes, with no CRM lookup', async () => {
    vi.stubEnv('FEDERATION_API_TOKEN', 'svc-token')
    vi.resetModules()
    const mod = await import('../request-context')
    const ctx = await mod.createAppContextFromRequest(
      new Request('https://crm.example.test/api/trpc/leads.list', {
        headers: { authorization: 'Bearer svc-token' },
      }),
      'trpc',
    )

    expect(ctx.auth.roles).toEqual(['service'])
    expect(ctx.auth.scopes).toEqual([...SERVICE_AUTH_SCOPES])
    expect(fakeDb.lookups).toBe(0)
  })

  it('no session, no roles', async () => {
    authMock.mockResolvedValue(null)
    const ctx = await createAppContextFromRequest(new Request('https://crm.example.test/'), 'trpc')
    expect(ctx.auth.roles).toEqual([])
  })
})

describe('staff bootstrap (PHYND_BOOTSTRAP_STAFF, subjects only)', () => {
  it('creates a linked CRM user with the listed role for a listed subject', async () => {
    vi.stubEnv('PHYND_BOOTSTRAP_STAFF', `admin:sub:${ana.sub},manager:sub:${beto.sub}`)

    const { auth } = await callerFor(beto)

    expect(auth.roles).toEqual(['manager'])
    expect(fakeDb.users).toEqual([
      expect.objectContaining({ email: beto.email, role: 'manager', externalJanuaId: beto.sub }),
    ])
    expect(auth.crmUserId).toBe(fakeDb.users[0]?.id)
  })

  it('ignores an email entry, even for the account with that email', async () => {
    vi.stubEnv('PHYND_BOOTSTRAP_STAFF', `admin:${ana.email}`)
    fakeDb.users.push({ id: ANA_ID, email: ana.email, role: 'viewer', externalJanuaId: null })

    const { auth } = await callerFor(ana)

    expect(auth.userId).toBe('')
    expect(fakeDb.byId(ANA_ID)).toMatchObject({ role: 'viewer', externalJanuaId: null })
    expect(fakeDb.inserted).toHaveLength(0)
  })

  it('leaves an already linked subject as it is (the Users screen is the source of truth)', async () => {
    fakeDb.link(ana.sub, ANA_ID, 'viewer', ana.email)
    vi.stubEnv('PHYND_BOOTSTRAP_STAFF', `admin:sub:${ana.sub}`)

    const { auth } = await callerFor(ana)

    expect(auth.roles).toEqual(['viewer'])
    expect(fakeDb.inserted).toHaveLength(0)
  })

  it('while the entry stays listed, unlinking the user does not revoke access: the next request bootstraps again', async () => {
    fakeDb.link(beto.sub, BETO_ID, 'admin')
    vi.stubEnv('PHYND_BOOTSTRAP_STAFF', `manager:sub:${ana.sub}`)
    expect((await callerFor(ana)).auth.roles).toEqual(['manager'])
    const firstId = fakeDb.users.find((u) => u.externalJanuaId === ana.sub)?.id ?? ''

    const { caller: admin } = await callerFor(beto)
    await admin.users.unlinkJanua({ id: firstId })

    const again = await callerFor(ana)
    expect(again.auth.roles).toEqual(['manager'])
    expect(again.auth.crmUserId).not.toBe(firstId)
  })

  it('a refused entry (no email in the session) is remembered, not retried on every request', async () => {
    vi.stubEnv('PHYND_BOOTSTRAP_STAFF', `admin:sub:${ana.sub}`)
    const session = { user: { id: ana.sub, roles: [], scopes: [] }, accessToken: 't' }
    authMock.mockResolvedValue(session)

    await resolveAuthContext(new Headers())
    crmUserResolver.clear() // even with a fresh CRM-user lookup
    const lookups = fakeDb.lookups
    const auth = await resolveAuthContext(new Headers())

    expect(auth.userId).toBe('')
    expect(fakeDb.inserted).toHaveLength(0)
    expect(fakeDb.lookups).toBe(lookups + 1) // the link lookup only, no provisioning
  })
})

describe('the last linked admin is protected', () => {
  beforeEach(() => {
    fakeDb.link(ana.sub, ANA_ID, 'admin')
    fakeDb.link(beto.sub, BETO_ID, 'manager')
  })

  it('cannot be demoted, unlinked or deleted', async () => {
    const { caller } = await callerFor(ana)

    await expect(caller.users.update({ id: ANA_ID, role: 'manager' })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(caller.users.unlinkJanua({ id: ANA_ID })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(caller.users.delete({ id: ANA_ID })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(fakeDb.byId(ANA_ID)).toMatchObject({ role: 'admin', externalJanuaId: ana.sub })
  })

  it('can be demoted once another linked admin exists', async () => {
    const { caller } = await callerFor(ana)
    await caller.users.update({ id: BETO_ID, role: 'admin' })

    await caller.users.update({ id: ANA_ID, role: 'manager' })

    expect(fakeDb.byId(ANA_ID)?.role).toBe('manager')
  })
})

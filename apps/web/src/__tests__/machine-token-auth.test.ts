/**
 * Janua machine tokens through the real tRPC fetch handler and the real
 * `protectedProcedure` scope enforcement, against a tiny router whose paths
 * mirror phynd's (`engagements.*`, `contacts.*`, `leads.*`,
 * `campaignAuthorizations.*`). The legacy static bearer runs alongside.
 */
import { protectedProcedure, router } from '@phynd/api'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AUDIENCE,
  CLIENT_ID,
  MACHINE_ENV,
  TENANT_ID,
  createMachineTokenStub,
} from '@/lib/trpc/__tests__/machine-token-stub'

const { STATIC_TOKEN, authMock, logCalls } = vi.hoisted(() => {
  const STATIC_TOKEN = 'static-federation-token-for-tests-0123456789'
  // Read once at module load by request-context.ts, like in production.
  process.env.FEDERATION_API_TOKEN = STATIC_TOKEN
  return { STATIC_TOKEN, authMock: vi.fn(), logCalls: [] as unknown[][] }
})

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@phynd/db', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/federation/clients', () => ({
  getCacheManager: () => ({}),
  getFederationClients: () => ({}),
  getHealthChecker: () => ({}),
}))
vi.mock('@phynd/logging', () => ({
  createLogger: () => {
    const record =
      (level: string) =>
      (...args: unknown[]) =>
        logCalls.push([level, ...args])
    return {
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
    }
  },
}))

import { SERVICE_AUTH_SCOPES, createAppContextFromRequest } from '@/lib/trpc/request-context'

const whoAmI = protectedProcedure.query(({ ctx }) => ({
  userId: ctx.auth.userId,
  tenantId: ctx.auth.tenantId,
  roles: ctx.auth.roles,
  scopes: ctx.auth.scopes,
}))
const write = protectedProcedure.mutation(() => 'written')

const testRouter = router({
  engagements: router({ getById: whoAmI, getTimeline: whoAmI, update: write }),
  contacts: router({ getById: whoAmI, delete: write }),
  leads: router({ list: whoAmI }),
  campaignAuthorizations: router({ list: whoAmI, decide: write }),
  aiKanban: router({ move: write }),
})

/** A staff session that must never be consulted when a machine token is present. */
const STAFF_SESSION = {
  user: { id: 'janua-staff-sub', roles: ['admin'], scopes: [] },
  accessToken: 'session-access-token',
}

async function call(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    bearer?: string
    host?: string
    surface?: 'trpc' | 'graphql'
  } = {},
) {
  const method = options.method ?? 'GET'
  const headers = new Headers({ host: options.host ?? 'crm.madfam.io' })
  if (options.bearer) headers.set('authorization', `Bearer ${options.bearer}`)
  if (method === 'POST') headers.set('content-type', 'application/json')
  const req = new Request(`https://${options.host ?? 'crm.madfam.io'}/api/trpc/${path}`, {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify({ json: null }) } : {}),
  })
  const res = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: testRouter,
    createContext: () => createAppContextFromRequest(req, options.surface ?? 'trpc'),
  })
  const body = (await res.json()) as {
    result?: { data: { json: Record<string, unknown> } }
    error?: { json: { data: { code: string } } }
  }
  return { status: res.status, data: body.result?.data.json, code: body.error?.json.data.code }
}

let stub: Awaited<ReturnType<typeof createMachineTokenStub>>

beforeAll(async () => {
  stub = await createMachineTokenStub()
})

beforeEach(() => {
  logCalls.length = 0
  authMock.mockReset()
  authMock.mockResolvedValue(null)
  stub.installJwks()
  for (const [name, value] of Object.entries(MACHINE_ENV)) vi.stubEnv(name, value)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Janua machine token (configured)', () => {
  it('reads engagements and contacts as service:<client_id> in the configured tenant', async () => {
    const token = await stub.mint()
    for (const path of ['engagements.getById', 'engagements.getTimeline', 'contacts.getById']) {
      const res = await call(path, { bearer: token })
      expect(res.status).toBe(200)
      expect(res.data).toEqual({
        userId: `service:${CLIENT_ID}`,
        tenantId: TENANT_ID,
        roles: ['service'],
        scopes: ['contacts:read', 'engagements:read'],
      })
    }
  })

  it('binds the tenant from configuration, never from the Host header', async () => {
    const res = await call('engagements.getById', { bearer: await stub.mint(), host: 'phynd.app' })
    expect(res.status).toBe(200)
    expect(res.data?.tenantId).toBe(TENANT_ID)
  })

  it('is forbidden from reads outside its mapping', async () => {
    const token = await stub.mint()
    for (const path of ['leads.list', 'campaignAuthorizations.list']) {
      const res = await call(path, { bearer: token })
      expect(res.status).toBe(403)
      expect(res.code).toBe('FORBIDDEN')
    }
  })

  it('is forbidden from every write, the campaign send gate included', async () => {
    const token = await stub.mint()
    for (const path of [
      'engagements.update',
      'contacts.delete',
      'campaignAuthorizations.decide',
      'aiKanban.move',
    ]) {
      const res = await call(path, { method: 'POST', bearer: token })
      expect(res.status).toBe(403)
      expect(res.code).toBe('FORBIDDEN')
    }
  })

  it('logs the client id and scopes, never the token', async () => {
    const token = await stub.mint()
    await call('engagements.getById', { bearer: token })
    const accepted = logCalls.find(
      ([level, fields]) =>
        level === 'info' && (fields as { event?: string }).event === 'machine_auth',
    )
    expect(accepted?.[1]).toMatchObject({
      clientId: CLIENT_ID,
      userId: `service:${CLIENT_ID}`,
      tokenScopes: ['phynd-crm-engagements:read'],
      grantedScopes: ['contacts:read', 'engagements:read'],
      tenantId: TENANT_ID,
    })
    expect(JSON.stringify(logCalls)).not.toContain(token)
  })

  it.each([
    ['wrong aud', () => stub.mint({ aud: 'phynd-crm-api' })],
    ['wrong iss', () => stub.mint({ iss: 'https://issuer.attacker.test' })],
    ['expired', () => stub.mint({ iat: 1_700_000_000, exp: 1_700_000_900 })],
    ['wrong token_use', () => stub.mint({ claims: { token_use: 'authorization_code' } })],
    ['unknown scope', () => stub.mint({ claims: { scope: 'hcm:hr' } })],
    ['no scope', () => stub.mint({ claims: { scope: undefined } })],
  ])('%s → 401, with no fallback to the staff session', async (_name, mintToken) => {
    authMock.mockResolvedValue(STAFF_SESSION)
    const token = await mintToken()
    const res = await call('engagements.getById', { bearer: token })
    expect(res.status).toBe(401)
    expect(res.code).toBe('UNAUTHORIZED')
    expect(authMock).not.toHaveBeenCalled()
    const refused = logCalls.find(
      ([, fields]) => (fields as { event?: string }).event === 'machine_auth_rejected',
    )
    expect(refused?.[0]).toBe('warn')
    expect(JSON.stringify(logCalls)).not.toContain(token)
  })

  it('is not honoured on the GraphQL surface', async () => {
    const ctx = await createAppContextFromRequest(
      new Request('https://crm.madfam.io/api/graphql', {
        method: 'POST',
        headers: { authorization: `Bearer ${await stub.mint()}` },
      }),
      'graphql',
    )
    expect(ctx.auth.userId).toBe('')
    expect(ctx.auth.scopes).toEqual([])
    expect(authMock).not.toHaveBeenCalled()
  })

  it('serves queries over GET only: a POST to a query is refused by tRPC', async () => {
    const res = await call('engagements.getById', { method: 'POST', bearer: await stub.mint() })
    expect(res.status).toBe(405)
  })
})

describe('legacy static bearer', () => {
  it('is unchanged when machine tokens are configured', async () => {
    const res = await call('leads.list', { bearer: STATIC_TOKEN })
    expect(res.status).toBe(200)
    expect(res.data).toEqual({
      userId: 'service:selva',
      tenantId: 'madfam',
      roles: ['service'],
      scopes: [...SERVICE_AUTH_SCOPES],
    })
    expect(stub.jwksUrls).toEqual([])
  })

  it('still reaches its write scopes', async () => {
    const res = await call('campaignAuthorizations.decide', {
      method: 'POST',
      bearer: STATIC_TOKEN,
    })
    expect(res.status).toBe(200)
    expect(res.data).toBe('written')
  })
})

describe('machine tokens not configured (the default)', () => {
  it.each(Object.keys(MACHINE_ENV))(
    'without %s a Janua machine token is not honoured and the request is handled as before',
    async (name) => {
      vi.stubEnv(name, '')
      authMock.mockResolvedValue(null)
      const res = await call('engagements.getById', { bearer: await stub.mint() })
      expect(res.status).toBe(401)
      // Exactly today's path: the session cookie is consulted, Janua's JWKS is not.
      expect(authMock).toHaveBeenCalledOnce()
      expect(stub.jwksUrls).toEqual([])
    },
  )

  it('the audience default alone does not turn machine tokens on', async () => {
    for (const name of Object.keys(MACHINE_ENV)) vi.stubEnv(name, '')
    vi.stubEnv('PHYND_CRM_MACHINE_AUDIENCE', AUDIENCE)
    const res = await call('engagements.getById', { bearer: await stub.mint() })
    expect(res.status).toBe(401)
    expect(stub.jwksUrls).toEqual([])
  })
})

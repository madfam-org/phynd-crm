import { generateKeyPair } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_MACHINE_AUDIENCE,
  MACHINE_SCOPE_GRANTS,
  type MachineAuthConfig,
  bearerJwt,
  grantedScopes,
  machineAuthConfig,
  verifyMachineToken,
} from '../machine-auth'
import { SERVICE_AUTH_SCOPES } from '../request-context'
import {
  AUDIENCE,
  CLIENT_ID,
  ISSUER,
  MACHINE_ENV,
  ORG_ID,
  OTHER_ORG_ID,
  TENANT_ID,
  createMachineTokenStub,
} from './machine-token-stub'

vi.mock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))

const CONFIG: MachineAuthConfig = {
  issuer: ISSUER,
  audience: AUDIENCE,
  tenantId: TENANT_ID,
  januaOrgId: ORG_ID,
}

let stub: Awaited<ReturnType<typeof createMachineTokenStub>>

beforeAll(async () => {
  stub = await createMachineTokenStub()
})

describe('machineAuthConfig', () => {
  it('is off unless issuer, tenant and Janua org are all set', () => {
    expect(machineAuthConfig({})).toBeNull()
    expect(machineAuthConfig({ ...MACHINE_ENV, AUTH_JANUA_ISSUER: '' })).toBeNull()
    expect(machineAuthConfig({ ...MACHINE_ENV, PHYND_CRM_MACHINE_TENANT_ID: '' })).toBeNull()
    expect(machineAuthConfig({ ...MACHINE_ENV, PHYND_CRM_MACHINE_JANUA_ORG_ID: ' ' })).toBeNull()
  })

  it('defaults the audience to phynd-crm and trims a trailing slash off the issuer', () => {
    expect(machineAuthConfig({ ...MACHINE_ENV, AUTH_JANUA_ISSUER: `${ISSUER}/` })).toEqual({
      issuer: ISSUER,
      audience: DEFAULT_MACHINE_AUDIENCE,
      tenantId: TENANT_ID,
      januaOrgId: ORG_ID,
    })
    expect(DEFAULT_MACHINE_AUDIENCE).toBe('phynd-crm')
    expect(
      machineAuthConfig({ ...MACHINE_ENV, PHYND_CRM_MACHINE_AUDIENCE: 'phynd-crm-staging' })
        ?.audience,
    ).toBe('phynd-crm-staging')
  })

  it('refuses a demo or malformed tenant', () => {
    expect(
      machineAuthConfig({ ...MACHINE_ENV, PHYND_CRM_MACHINE_TENANT_ID: 'demo-abc' }),
    ).toBeNull()
    expect(
      machineAuthConfig({ ...MACHINE_ENV, PHYND_CRM_MACHINE_TENANT_ID: 'Bad Tenant' }),
    ).toBeNull()
  })
})

describe('bearerJwt', () => {
  it('returns only JWT-shaped bearer tokens', () => {
    expect(bearerJwt('Bearer aaa.bbb.ccc')).toBe('aaa.bbb.ccc')
    expect(bearerJwt('bearer aaa.bbb.ccc')).toBe('aaa.bbb.ccc')
    expect(bearerJwt('Bearer a-static-shared-token')).toBeNull()
    expect(bearerJwt('Bearer abc+/=.def.ghi')).toBeNull()
    expect(bearerJwt('Basic aaa.bbb.ccc')).toBeNull()
    expect(bearerJwt('')).toBeNull()
  })
})

describe('MACHINE_SCOPE_GRANTS', () => {
  it('maps the portal scope to engagement and contact reads only', () => {
    expect(grantedScopes(['phynd-crm-engagements:read'])).toEqual([
      'contacts:read',
      'engagements:read',
    ])
  })

  it('grants nothing for unknown or prototype-named scopes', () => {
    expect(grantedScopes(['hcm:hr', 'constructor', '__proto__', 'toString', '*'])).toEqual([])
  })

  it('is read-only and never reaches the static bearer write scopes or a wildcard', () => {
    for (const [janua, internal] of MACHINE_SCOPE_GRANTS) {
      expect(janua).toMatch(/^phynd-crm-[a-z-]+:read$/)
      for (const scope of internal) {
        expect(scope).toMatch(/^[a-zA-Z]+:read$/)
      }
    }
    const everything = grantedScopes([...MACHINE_SCOPE_GRANTS.keys()])
    expect(everything).not.toContain('aiKanban:write')
    expect(everything).not.toContain('campaignAuthorizations:write')
    expect(everything.length).toBeLessThan(SERVICE_AUTH_SCOPES.length)
  })
})

describe('verifyMachineToken', () => {
  beforeEach(() => {
    stub.installJwks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts a valid token as a read-only service principal named after its client', async () => {
    const result = await verifyMachineToken(await stub.mint(), CONFIG)
    expect(result).toEqual({
      ok: true,
      clientId: CLIENT_ID,
      tokenScopes: ['phynd-crm-engagements:read'],
      auth: {
        userId: `service:${CLIENT_ID}`,
        tenantId: TENANT_ID,
        roles: ['service'],
        scopes: ['contacts:read', 'engagements:read'],
        accessToken: '',
      },
    })
    expect(stub.jwksUrls).toEqual([`${ISSUER}/.well-known/jwks.json`])
  })

  it('accepts an audience list that includes phynd-crm', async () => {
    const token = await stub.mint({ aud: ['some-other-api', AUDIENCE] })
    expect((await verifyMachineToken(token, CONFIG)).ok).toBe(true)
  })

  it('keeps only the mapped part of a multi-scope token', async () => {
    const token = await stub.mint({ claims: { scope: 'hcm:hr phynd-crm-engagements:read' } })
    const result = await verifyMachineToken(token, CONFIG)
    expect(result.ok && result.auth.scopes).toEqual(['contacts:read', 'engagements:read'])
  })

  const now = () => Math.floor(Date.now() / 1000)
  const refusals: Array<[string, () => Promise<string>, string]> = [
    ['wrong audience', () => stub.mint({ aud: 'phynd-crm-api' }), 'invalid_token'],
    ['wrong issuer', () => stub.mint({ iss: 'https://issuer.attacker.test' }), 'invalid_token'],
    ['expired', () => stub.mint({ iat: now() - 7200, exp: now() - 3600 }), 'invalid_token'],
    [
      'signed by another key',
      async () => stub.mint({ key: (await generateKeyPair('RS256')).privateKey }),
      'invalid_token',
    ],
    [
      'a user token',
      () => stub.mint({ claims: { token_use: undefined } }),
      'not_client_credentials',
    ],
    [
      'wrong token_use',
      () => stub.mint({ claims: { token_use: 'authorization_code' } }),
      'not_client_credentials',
    ],
    [
      'not a service account',
      () => stub.mint({ claims: { actor_type: 'user' } }),
      'not_client_credentials',
    ],
    ['a refresh token', () => stub.mint({ claims: { type: 'refresh' } }), 'not_client_credentials'],
    ['no client_id', () => stub.mint({ claims: { client_id: undefined } }), 'bad_subject'],
    ['sub of another client', () => stub.mint({ sub: 'service-account:jnc_other' }), 'bad_subject'],
    ['a user subject', () => stub.mint({ sub: 'usr-0001' }), 'bad_subject'],
    ['lifetime over an hour', () => stub.mint({ exp: now() + 7200 }), 'bad_lifetime'],
    ['another organization', () => stub.mint({ claims: { org_id: OTHER_ORG_ID } }), 'org_mismatch'],
    ['no organization', () => stub.mint({ claims: { org_id: undefined } }), 'org_mismatch'],
    ['no scope', () => stub.mint({ claims: { scope: undefined } }), 'no_scope'],
    ['an empty scope', () => stub.mint({ claims: { scope: '  ' } }), 'no_scope'],
    ['an array scope', () => stub.mint({ claims: { scope: ['x'] } }), 'no_scope'],
    ['an unknown scope', () => stub.mint({ claims: { scope: 'hcm:hr' } }), 'no_mapped_scope'],
    [
      'the scope name of a write it does not have',
      () => stub.mint({ claims: { scope: 'campaignAuthorizations:write' } }),
      'no_mapped_scope',
    ],
  ]

  it.each(refusals)('refuses %s', async (_name, mintToken, reason) => {
    const result = await verifyMachineToken(await mintToken(), CONFIG)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe(reason)
  })

  it('refuses a token whose org is right but whose configured audience differs', async () => {
    const result = await verifyMachineToken(await stub.mint(), {
      ...CONFIG,
      audience: 'phynd-crm-staging',
    })
    expect(!result.ok && result.reason).toBe('invalid_token')
  })

  it('refuses, without throwing, when the JWKS cannot be fetched', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'))
    const result = await verifyMachineToken(await stub.mint(), {
      ...CONFIG,
      issuer: 'https://unreachable.janua.test',
    })
    expect(!result.ok && result.reason).toBe('invalid_token')
  })
})

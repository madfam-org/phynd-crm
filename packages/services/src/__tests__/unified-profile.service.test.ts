import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnifiedProfileService as UnifiedProfileServiceImpl } from '../unified-profile/profile.service'
import { createTestContext } from './helpers'

type ProfileDeps = ConstructorParameters<typeof UnifiedProfileServiceImpl>[1]

const unavailable = {
  data: null,
  status: 'unavailable' as const,
  cachedAt: null,
  error: null,
}

function makeDeps(): ProfileDeps {
  const fetch = vi.fn().mockResolvedValue(unavailable)
  return {
    januaClient: { fetch },
    dhanamClient: { fetch },
    cotizaClient: { fetch },
    pravaraClient: { fetch },
    forjClient: { fetch },
    januaTelemetryClient: { fetch },
  } as unknown as ProfileDeps
}

describe('UnifiedProfileService production truth', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not return mock federation data in production when providers are unavailable', async () => {
    const ctx = createTestContext()
    const contact = {
      id: 'contact-tablaco',
      name: 'Rodrigo Tablaco',
      email: 'rodrigo@tablaco.mx',
      company: 'Tablaco',
      phone: null,
      status: 'active',
      ownerId: 'admin',
      externalJanuaId: 'janua-tablaco-001',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    ctx.mockDb._qb._result = [contact]
    const service = new UnifiedProfileServiceImpl(ctx, makeDeps())
    const profile = await service.getProfile('contact-tablaco', 'token')

    expect(profile.identity?.status).toBe('unavailable')
    expect(profile.federationStatus?.tezca).toBe('unavailable')
    expect(profile.contact).toEqual(contact)
    expect('manufacturing' in profile && profile.manufacturing).toBeDefined()
  })
})

describe('UnifiedProfileService development mock fallback', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns Tablaco mock data in development when all core providers are unavailable', async () => {
    const ctx = createTestContext()
    const contact = {
      id: 'contact-tablaco',
      name: 'Rodrigo Tablaco',
      email: 'rodrigo@tablaco.mx',
      company: 'Tablaco',
      phone: null,
      status: 'active',
      ownerId: 'admin',
      externalJanuaId: 'janua-tablaco-001',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    ctx.mockDb._qb._result = [contact]
    const service = new UnifiedProfileServiceImpl(ctx, makeDeps())
    const profile = await service.getProfile('contact-tablaco', 'token')

    expect(profile.identity?.data).toBeTruthy()
    expect(profile.federationStatus?.janua).toBe('ok')
  })
})

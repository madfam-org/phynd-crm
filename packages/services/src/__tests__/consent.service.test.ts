import { describe, expect, it } from 'vitest'
import { ConsentService } from '../consent/consent.service'
import { generateDoubleOptInToken, hashDoubleOptInToken } from '../consent/double-opt-in-token'
import { NotFoundError, ValidationError } from '../errors'
import { type MockDatabase, createTestContext } from './helpers'

function sequenceResults(db: MockDatabase, results: unknown[]) {
  let call = 0
  db._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
    const result = call < results.length ? results[call] : []
    call += 1
    return Promise.resolve(result).then(resolve)
  })
}

function makeConsentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'consent-001',
    identifier: 'persona@example.mx',
    channel: 'email',
    status: 'pending_double_opt_in',
    source: 'dhanam_signup_form',
    evidence: null,
    contactId: null,
    doubleOptInTokenHash: null,
    doubleOptInExpiresAt: null,
    grantedAt: null,
    revokedAt: null,
    metadata: {},
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  }
}

describe('ConsentService.capture', () => {
  it('creates a pending record and returns a raw double-opt-in token', async () => {
    const ctx = createTestContext()
    const inserted = makeConsentRecord()
    sequenceResults(ctx.mockDb, [
      [], // getConsent — no existing record
      [], // contact lookup by email
      [inserted], // insert consent record .returning()
      [], // audit insert
    ])

    const service = new ConsentService(ctx)
    const result = await service.capture({
      identifier: ' Persona@Example.MX ',
      channel: 'email',
      action: 'request_double_opt_in',
      source: 'dhanam_signup_form',
      evidence: 'Checkbox at /signup',
    })

    expect(result.record.status).toBe('pending_double_opt_in')
    expect(result.doubleOptIn?.token).toBeTruthy()
    expect(result.doubleOptIn?.expiresAt.getTime()).toBeGreaterThan(Date.now())
    // Transaction wraps record write + audit append
    expect(ctx.mockDb.transaction).toHaveBeenCalledTimes(1)
    expect(ctx.mockDb.insert).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid transitions (double opt-in request on granted record)', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[makeConsentRecord({ status: 'granted' })]])

    const service = new ConsentService(ctx)
    await expect(
      service.capture({
        identifier: 'persona@example.mx',
        channel: 'email',
        action: 'request_double_opt_in',
        source: 'tezca_newsletter',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('revoke on an existing granted record transitions to revoked', async () => {
    const ctx = createTestContext()
    const existing = makeConsentRecord({ status: 'granted', grantedAt: new Date() })
    const revoked = makeConsentRecord({ status: 'revoked', revokedAt: new Date() })
    sequenceResults(ctx.mockDb, [
      [existing], // getConsent
      [], // contact lookup by email (existing record has no contactId)
      [revoked], // update .returning()
      [], // audit insert
    ])

    const service = new ConsentService(ctx)
    const result = await service.capture({
      identifier: 'persona@example.mx',
      channel: 'email',
      action: 'revoke',
      source: 'karafiel_settings',
    })

    expect(result.record.status).toBe('revoked')
    expect(result.doubleOptIn).toBeUndefined()
    expect(ctx.mockDb.update).toHaveBeenCalledTimes(1)
  })

  it('revoke with no prior record creates a durable opt-out tombstone', async () => {
    const ctx = createTestContext()
    const tombstone = makeConsentRecord({ status: 'revoked' })
    sequenceResults(ctx.mockDb, [
      [], // getConsent
      [], // contact lookup
      [tombstone], // insert .returning()
      [], // audit insert
    ])

    const service = new ConsentService(ctx)
    const result = await service.capture({
      identifier: 'persona@example.mx',
      channel: 'email',
      action: 'revoke',
      source: 'tezca_unsubscribe',
    })
    expect(result.record.status).toBe('revoked')
  })

  it('rejects an invalid channel', async () => {
    const ctx = createTestContext()
    const service = new ConsentService(ctx)
    await expect(
      service.capture({
        identifier: 'persona@example.mx',
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
        channel: 'fax' as any,
        action: 'grant',
        source: 'manual',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('ConsentService.confirmDoubleOptIn', () => {
  it('confirms a pending record and appends an audit row', async () => {
    const { token, tokenHash } = generateDoubleOptInToken()
    const ctx = createTestContext()
    const pending = makeConsentRecord({
      doubleOptInTokenHash: tokenHash,
      doubleOptInExpiresAt: new Date(Date.now() + 60_000),
    })
    const granted = makeConsentRecord({ status: 'granted', grantedAt: new Date() })
    sequenceResults(ctx.mockDb, [
      [pending], // token lookup
      [granted], // update .returning()
      [], // audit insert
    ])

    const service = new ConsentService(ctx)
    const result = await service.confirmDoubleOptIn(token)
    expect(result.record.status).toBe('granted')
    expect(result.alreadyConfirmed).toBe(false)
  })

  it('is idempotent when the record is already granted', async () => {
    const ctx = createTestContext()
    const granted = makeConsentRecord({ status: 'granted' })
    sequenceResults(ctx.mockDb, [[granted]])

    const service = new ConsentService(ctx)
    const result = await service.confirmDoubleOptIn('any-token')
    expect(result.alreadyConfirmed).toBe(true)
    expect(ctx.mockDb.update).not.toHaveBeenCalled()
  })

  it('rejects an expired token', async () => {
    const ctx = createTestContext()
    const expired = makeConsentRecord({
      doubleOptInExpiresAt: new Date(Date.now() - 60_000),
    })
    sequenceResults(ctx.mockDb, [[expired]])

    const service = new ConsentService(ctx)
    await expect(service.confirmDoubleOptIn('stale')).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects a token after revocation', async () => {
    const ctx = createTestContext()
    const revoked = makeConsentRecord({
      status: 'revoked',
      doubleOptInExpiresAt: new Date(Date.now() + 60_000),
    })
    sequenceResults(ctx.mockDb, [[revoked]])

    const service = new ConsentService(ctx)
    await expect(service.confirmDoubleOptIn('revoked-token')).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('throws NotFoundError for an unknown token', async () => {
    const ctx = createTestContext([])
    const service = new ConsentService(ctx)
    await expect(service.confirmDoubleOptIn('unknown')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('ConsentService.checkPermission', () => {
  it('suppression wins over granted consent', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [
      // suppression check
      [{ id: 'sup-001', identifier: 'persona@example.mx', channel: 'all', reason: 'complaint' }],
      // consent lookup
      [makeConsentRecord({ status: 'granted' })],
    ])

    const service = new ConsentService(ctx)
    const permission = await service.checkPermission('persona@example.mx', 'email')
    expect(permission.consentStatus).toBe('granted')
    expect(permission.suppressed).toBe(true)
    expect(permission.suppressionReasons).toContain('complaint')
    expect(permission.permitted).toBe(false)
  })

  it('permits only granted + unsuppressed', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[], [makeConsentRecord({ status: 'granted' })]])

    const service = new ConsentService(ctx)
    const permission = await service.checkPermission('persona@example.mx', 'email')
    expect(permission.permitted).toBe(true)
  })

  it('does not permit pending consent', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[], [makeConsentRecord({ status: 'pending_double_opt_in' })]])

    const service = new ConsentService(ctx)
    const permission = await service.checkPermission('persona@example.mx', 'email')
    expect(permission.permitted).toBe(false)
  })
})

describe('double-opt-in token helpers', () => {
  it('hashes deterministically and never stores the raw token', () => {
    const { token, tokenHash } = generateDoubleOptInToken()
    expect(tokenHash).toBe(hashDoubleOptInToken(token))
    expect(tokenHash).not.toContain(token)
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

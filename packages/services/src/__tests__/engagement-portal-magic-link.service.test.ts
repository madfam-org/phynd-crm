import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngagementPortalMagicLinkService } from '../engagement-portal/magic-link.service'
import { NotFoundError, ServiceError, ValidationError } from '../errors'
import { createTestContext } from './helpers'

const JANUA_URL = 'https://auth.madfam.io'
const PORTAL_URL = 'https://phyne-crm.madfam.io'

function makeEngagementRow(overrides: Record<string, unknown> = {}) {
  return {
    engagementId: 'eng-tablaco-001',
    contactEmail: 'tablaco@example.com',
    ...overrides,
  }
}

function makeJanuaVerifyResponse(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'usr-janua-001',
      email: 'tablaco@example.com',
      email_verified: true,
    },
    tokens: {
      access_token: 'access-xyz',
      refresh_token: 'refresh-xyz',
      expires_in: 900,
      token_type: 'bearer' as const,
    },
    ...overrides,
  }
}

describe('EngagementPortalMagicLinkService', () => {
  const originalEnv = { ...process.env }
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.JANUA_API_URL = JANUA_URL
    process.env.PORTAL_BASE_URL = PORTAL_URL
    fetchSpy = vi.spyOn(global, 'fetch') as unknown as ReturnType<typeof vi.spyOn>
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  // ───────────────────── sendPortalLink ─────────────────────

  describe('sendPortalLink', () => {
    it('throws NotFoundError when engagement does not exist', async () => {
      const ctx = createTestContext([])
      const service = new EngagementPortalMagicLinkService(ctx)
      await expect(service.sendPortalLink('missing')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('throws ValidationError when contact has no email on file', async () => {
      const ctx = createTestContext([makeEngagementRow({ contactEmail: null })])
      const service = new EngagementPortalMagicLinkService(ctx)
      await expect(service.sendPortalLink('eng-1')).rejects.toBeInstanceOf(ValidationError)
    })

    it('POSTs to Janua /api/v1/auth/magic-link with the correct redirect_url and returns redacted email', async () => {
      const ctx = createTestContext([makeEngagementRow()])
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      } as unknown as Response)

      const service = new EngagementPortalMagicLinkService(ctx)
      const result = await service.sendPortalLink('eng-tablaco-001')

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${JANUA_URL}/api/v1/auth/magic-link`)

      const body = JSON.parse(init.body as string)
      expect(body.email).toBe('tablaco@example.com')
      expect(body.redirect_url).toBe(`${PORTAL_URL}/portal/verify?engagement=eng-tablaco-001`)

      expect(result.sent).toBe(true)
      // Email is redacted to avoid leaking the address back to the caller
      expect(result.emailRedacted).toBe('ta***@example.com')
    })

    it('maps 429 from Janua to a 429 ServiceError (rate-limit passthrough)', async () => {
      const ctx = createTestContext([makeEngagementRow()])
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'slow down',
      } as unknown as Response)

      const service = new EngagementPortalMagicLinkService(ctx)
      await expect(service.sendPortalLink('eng-tablaco-001')).rejects.toSatisfy(
        (err: unknown) => err instanceof ServiceError && (err as ServiceError).statusCode === 429,
      )
    })
  })

  // ───────────────────── verifyPortalLink ─────────────────────

  describe('verifyPortalLink', () => {
    it('throws ValidationError on an obviously bad token', async () => {
      const ctx = createTestContext([makeEngagementRow()])
      const service = new EngagementPortalMagicLinkService(ctx)
      await expect(
        service.verifyPortalLink({ token: 'tiny', engagementId: 'eng-1' }),
      ).rejects.toBeInstanceOf(ValidationError)
    })

    it('throws NotFoundError when engagement does not exist', async () => {
      const ctx = createTestContext([])
      const service = new EngagementPortalMagicLinkService(ctx)
      await expect(
        service.verifyPortalLink({
          token: 'a'.repeat(40),
          engagementId: 'missing',
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('returns the portal session when Janua verifies and the email matches', async () => {
      const ctx = createTestContext([makeEngagementRow()])
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => makeJanuaVerifyResponse(),
      } as unknown as Response)

      const service = new EngagementPortalMagicLinkService(ctx)
      const session = await service.verifyPortalLink({
        token: 'x'.repeat(40),
        engagementId: 'eng-tablaco-001',
      })

      expect(session.accessToken).toBe('access-xyz')
      expect(session.refreshToken).toBe('refresh-xyz')
      expect(session.email).toBe('tablaco@example.com')
      expect(session.januaUserId).toBe('usr-janua-001')
      expect(session.expiresAt).toBeGreaterThan(Date.now())
    })

    it('normalizes case + whitespace when comparing emails', async () => {
      const ctx = createTestContext([makeEngagementRow({ contactEmail: ' TabLaco@Example.Com ' })])
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () =>
          makeJanuaVerifyResponse({
            user: { id: 'u', email: 'tablaco@example.com', email_verified: true },
          }),
      } as unknown as Response)

      const service = new EngagementPortalMagicLinkService(ctx)
      await expect(
        service.verifyPortalLink({ token: 'x'.repeat(40), engagementId: 'eng-1' }),
      ).resolves.toBeDefined()
    })

    it('rejects with AUTHZ_MISMATCH when Janua-verified email does not match engagement contact', async () => {
      const ctx = createTestContext([makeEngagementRow({ contactEmail: 'tablaco@example.com' })])
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () =>
          makeJanuaVerifyResponse({
            user: { id: 'attacker', email: 'attacker@example.com', email_verified: true },
          }),
      } as unknown as Response)

      const service = new EngagementPortalMagicLinkService(ctx)
      await expect(
        service.verifyPortalLink({ token: 'x'.repeat(40), engagementId: 'eng-1' }),
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof ServiceError && (err as ServiceError).code === 'AUTHZ_MISMATCH',
      )
    })

    it('maps Janua 400 (expired/invalid magic link) to a 401 ServiceError', async () => {
      const ctx = createTestContext([makeEngagementRow()])
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'expired',
      } as unknown as Response)

      const service = new EngagementPortalMagicLinkService(ctx)
      await expect(
        service.verifyPortalLink({ token: 'x'.repeat(40), engagementId: 'eng-1' }),
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof ServiceError && (err as ServiceError).statusCode === 401,
      )
    })

    it('accepts legacy flat Janua response shape (access_token at top level)', async () => {
      const ctx = createTestContext([makeEngagementRow()])
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          user: { id: 'u', email: 'tablaco@example.com', email_verified: true },
          access_token: 'flat-access',
          refresh_token: 'flat-refresh',
          expires_in: 600,
        }),
      } as unknown as Response)

      const service = new EngagementPortalMagicLinkService(ctx)
      const session = await service.verifyPortalLink({
        token: 'x'.repeat(40),
        engagementId: 'eng-1',
      })
      expect(session.accessToken).toBe('flat-access')
      expect(session.refreshToken).toBe('flat-refresh')
    })
  })
})

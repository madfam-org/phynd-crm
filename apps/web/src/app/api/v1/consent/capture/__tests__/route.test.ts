import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Attribution threading (RFC 0035 P4): the capture route must fold the
// landing-form UTMs + fortuna signal id into consent_records.metadata without
// ever touching the consent-gate decision. These tests pin the metadata shape
// handed to ConsentService.capture.
//
// vi.mock() factories are hoisted above const declarations, so the spies they
// reference live in vi.hoisted().
// ---------------------------------------------------------------------------

const { mockParseSigned, mockResolveTenant, mockCapture, mockSend } = vi.hoisted(() => ({
  mockParseSigned: vi.fn(),
  mockResolveTenant: vi.fn(() => 'madfam'),
  mockCapture: vi.fn(),
  mockSend: vi.fn(),
}))

vi.mock('@/lib/webhooks/handler', () => ({
  parseSignedWebhookRequest: (...args: unknown[]) => mockParseSigned(...args),
}))

vi.mock('@/lib/webhooks/engagement-writer', () => ({
  resolveTenantIdForWebhook: () => mockResolveTenant(),
}))

vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock('@phynd/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@phynd/services', () => {
  const consentChannels = ['email', 'sms', 'whatsapp']
  const consentActions = ['grant', 'revoke', 'request_double_opt_in', 'confirm_double_opt_in']
  class MockConsentService {
    capture = mockCapture
  }
  class MockEmailService {
    send = mockSend
  }
  return {
    ConsentService: MockConsentService,
    EmailService: MockEmailService,
    createServiceContext: vi.fn(() => ({})),
    buildConsentConfirmUrl: (token: string) => `https://phynd.test/confirm/${token}`,
    isConsentChannel: (c: unknown) => typeof c === 'string' && consentChannels.includes(c),
    isConsentAction: (a: unknown) => typeof a === 'string' && consentActions.includes(a),
  }
})

vi.mock('@phynd/services/email/templates/consent-confirm', () => ({
  consentConfirmEmail: () => ({ subject: 'Confirma', html: '<p>Confirma</p>' }),
}))

vi.mock('@phynd/services/errors', () => ({
  ValidationError: class ValidationError extends Error {},
}))

import { POST } from '../route'

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/consent/capture', {
    method: 'POST',
    body: '{}',
  })
}

const GRANTED_RESULT = {
  record: { identifier: 'persona@example.mx', channel: 'email', status: 'granted' },
}

describe('POST /api/v1/consent/capture — attribution threading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PHYND_CONSENT_EVENTS_SECRET = 'test-secret'
    mockResolveTenant.mockReturnValue('madfam')
    mockCapture.mockResolvedValue(GRANTED_RESULT)
  })

  afterEach(() => {
    delete process.env.PHYND_CONSENT_EVENTS_SECRET
  })

  it('folds UTMs + insight_id into consent metadata under standardized keys', async () => {
    mockParseSigned.mockResolvedValue({
      ok: true,
      remaining: 99,
      payload: {
        email: 'persona@example.mx',
        channel: 'email',
        action: 'grant',
        source: 'dhanam_signup_form',
        utm_source: 'fortuna',
        utm_medium: 'insight',
        utm_campaign: 'peso-goldilocks',
        utm_content: 'sig_dhanam_abc123def456',
        insight_id: 'sig_dhanam_abc123def456',
      },
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'persona@example.mx',
        channel: 'email',
        action: 'grant',
        source: 'dhanam_signup_form',
        metadata: {
          utm_source: 'fortuna',
          utm_medium: 'insight',
          utm_campaign: 'peso-goldilocks',
          utm_content: 'sig_dhanam_abc123def456',
          fortuna_signal_id: 'sig_dhanam_abc123def456',
        },
      }),
    )
  })

  it('falls back to utm_content for fortuna_signal_id when insight_id is absent', async () => {
    mockParseSigned.mockResolvedValue({
      ok: true,
      remaining: 99,
      payload: {
        email: 'persona@example.mx',
        channel: 'email',
        action: 'grant',
        source: 'ceq_landing',
        utm_campaign: 'peso-goldilocks',
        utm_content: 'sig_ceq_deadbeef0000',
      },
    })

    await POST(makeRequest())

    const captureArg = mockCapture.mock.calls[0]?.[0] as { metadata: Record<string, unknown> }
    expect(captureArg.metadata.fortuna_signal_id).toBe('sig_ceq_deadbeef0000')
    expect(captureArg.metadata.utm_content).toBe('sig_ceq_deadbeef0000')
  })

  it('merges attribution on top of caller-supplied metadata', async () => {
    mockParseSigned.mockResolvedValue({
      ok: true,
      remaining: 99,
      payload: {
        email: 'persona@example.mx',
        channel: 'email',
        action: 'grant',
        source: 'dhanam_signup_form',
        metadata: { form_version: 'v3' },
        utm_campaign: 'peso-goldilocks',
        insight_id: 'sig_dhanam_abc123def456',
      },
    })

    await POST(makeRequest())

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          form_version: 'v3',
          utm_campaign: 'peso-goldilocks',
          fortuna_signal_id: 'sig_dhanam_abc123def456',
        },
      }),
    )
  })

  it('preserves prior verbatim-metadata behavior when no attribution is present', async () => {
    mockParseSigned.mockResolvedValue({
      ok: true,
      remaining: 99,
      payload: {
        email: 'persona@example.mx',
        channel: 'email',
        action: 'grant',
        source: 'manual',
      },
    })

    await POST(makeRequest())

    const captureArg = mockCapture.mock.calls[0]?.[0] as { metadata: unknown }
    expect(captureArg.metadata).toBeUndefined()
  })
})

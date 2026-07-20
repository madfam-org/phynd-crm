import { ValidationError } from '@phynd/services/errors'
import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — the real `@phynd/services/errors` module is intentionally NOT mocked
// so the route's `instanceof ValidationError` check matches the error we throw.
// ---------------------------------------------------------------------------
const mockConfirm = vi.fn()

vi.mock('@phynd/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@phynd/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@phynd/services', () => ({
  ConsentService: class {
    confirmDoubleOptIn = mockConfirm
  },
  createServiceContext: vi.fn(() => ({})),
}))

function confirmReq(token?: string): NextRequest {
  const url = token
    ? `http://localhost/api/consent/confirm?token=${token}`
    : 'http://localhost/api/consent/confirm'
  return { nextUrl: new URL(url) } as unknown as NextRequest
}

describe('GET /api/consent/confirm — per-product branding', () => {
  beforeEach(() => {
    mockConfirm.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when the token is missing', async () => {
    const { GET } = await import('@/app/api/consent/confirm/route')
    const res = await GET(confirmReq())
    expect(res.status).toBe(400)
  })

  it.each([
    ['karafiel_landing', 'Karafiel', '#7c3aed'],
    ['dhanam_signup', 'Dhanam', '#0f766e'],
    ['tezca_newsletter', 'Tezca', '#b91c1c'],
  ])('brands the confirmation page for source %s', async (source, entity, accent) => {
    mockConfirm.mockResolvedValueOnce({ alreadyConfirmed: false, record: { source } })

    const { GET } = await import('@/app/api/consent/confirm/route')
    const res = await GET(confirmReq('tok'))
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('Suscripción confirmada')
    expect(html).toContain(entity)
    expect(html).toContain(accent)
  })

  it('falls back to the generic MADFAM branding for unknown sources', async () => {
    mockConfirm.mockResolvedValueOnce({
      alreadyConfirmed: false,
      record: { source: 'ceq_interest:semantic_search' },
    })

    const { GET } = await import('@/app/api/consent/confirm/route')
    const res = await GET(confirmReq('tok'))
    const html = await res.text()

    expect(html).toContain('MADFAM')
    expect(html).toContain('#111827')
    expect(html).not.toContain('#7c3aed')
  })

  it('keeps the already-confirmed copy while still branding by product', async () => {
    mockConfirm.mockResolvedValueOnce({
      alreadyConfirmed: true,
      record: { source: 'dhanam_signup' },
    })

    const { GET } = await import('@/app/api/consent/confirm/route')
    const res = await GET(confirmReq('tok'))
    const html = await res.text()

    expect(html).toContain('ya estaba confirmado')
    expect(html).toContain('Dhanam')
  })

  it('renders the generic invalid-link page on a ValidationError', async () => {
    mockConfirm.mockRejectedValueOnce(new ValidationError('Double opt-in token expired'))

    const { GET } = await import('@/app/api/consent/confirm/route')
    const res = await GET(confirmReq('tok'))
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('Enlace no válido')
    // No consent record available → generic branding.
    expect(html).toContain('MADFAM')
  })
})

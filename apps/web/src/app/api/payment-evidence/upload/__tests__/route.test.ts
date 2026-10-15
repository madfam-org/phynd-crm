import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { contextMock, engagementMock, rateMock, fetchMock } = vi.hoisted(() => ({
  contextMock: vi.fn(),
  engagementMock: vi.fn(),
  rateMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/rate-limiter', () => ({ checkApiRateLimit: rateMock }))
vi.mock('@/lib/trpc/request-context', () => ({ createAppContextFromRequest: contextMock }))
vi.mock('@phynd/services', () => ({
  EngagementsService: vi.fn(() => ({ getById: engagementMock })),
}))
vi.mock('@phynd/logging', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn() }) }))

import { buildSyntheticReceiptPdf } from '../../../../../../../../packages/services/src/__tests__/fixtures/synthetic-receipt-pdf'
import { POST } from '../route'

const R2_ENV = {
  R2_BUCKET_NAME: 'phynd-crm-payment-evidence',
  R2_ENDPOINT_URL: 'https://example-account.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
}

const staff = {
  userId: 'janua-sub',
  crmUserId: 'crm-user-1',
  tenantId: 'madfam',
  roles: ['admin'],
  scopes: ['*'],
  accessToken: '',
}

function upload(bytes: Uint8Array | null, engagementId = 'eng-1') {
  const form = new FormData()
  form.set('engagementId', engagementId)
  if (bytes) form.set('file', new Blob([Buffer.from(bytes)]), 'comprobante')
  return new Request('http://localhost/api/payment-evidence/upload', { method: 'POST', body: form })
}

describe('POST /api/payment-evidence/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(process.env, R2_ENV)
    vi.stubGlobal('fetch', fetchMock)
    rateMock.mockResolvedValue({ allowed: true })
    contextMock.mockResolvedValue({ auth: staff })
    engagementMock.mockResolvedValue({ id: 'eng-1' })
    fetchMock.mockImplementation(
      async (_url: URL, init: RequestInit) =>
        new Response(null, { status: init.method === 'HEAD' ? 404 : 200 }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of Object.keys(R2_ENV)) delete process.env[key]
  })

  it('stores a receipt under its content hash and returns the extractor prefill', async () => {
    const res = await POST(upload(buildSyntheticReceiptPdf('simple')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.storageKey).toBe(`payment-evidence/${body.sha256}.pdf`)
    expect(body.mime).toBe('application/pdf')
    expect(body.extraction.fields).toMatchObject({ amount: '11603.56', originAccountLast4: '1234' })
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    expect(methods).toEqual(['HEAD', 'PUT'])
  })

  it('does not upload twice the same file (content-addressed)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    await POST(upload(buildSyntheticReceiptPdf('simple')))
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)
    expect(methods).toEqual(['HEAD'])
  })

  it('accepts an image without prefill (manual entry)', async () => {
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)])
    const body = await (await POST(upload(png))).json()
    expect(body.mime).toBe('image/png')
    expect(body.extraction).toBeNull()
  })

  it.each([
    [
      'a service token',
      () =>
        contextMock.mockResolvedValue({
          auth: { ...staff, roles: ['service'], userId: 'service:selva' },
        }),
      401,
    ],
    [
      'an unlinked Janua account',
      () => contextMock.mockResolvedValue({ auth: { ...staff, crmUserId: undefined } }),
      403,
    ],
    [
      'a demo session',
      () => contextMock.mockResolvedValue({ auth: { ...staff, tenantId: 'demo-123' } }),
      403,
    ],
    ['an unknown engagement', () => engagementMock.mockResolvedValue(null), 404],
    ['missing storage configuration', () => delete process.env.R2_BUCKET_NAME, 503],
  ])('refuses %s', async (_case, arrange, status) => {
    arrange()
    const res = await POST(upload(buildSyntheticReceiptPdf('simple')))
    expect(res.status).toBe(status)
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit).method === 'PUT')).toBe(
      false,
    )
  })

  it('refuses unsupported types and files over 10 MB, and a missing file', async () => {
    expect((await POST(upload(Buffer.from('GIF89a-not-allowed')))).status).toBe(415)
    const big = Buffer.alloc(10 * 1024 * 1024 + 1)
    big.write('%PDF-')
    expect((await POST(upload(big))).status).toBe(413)
    expect((await POST(upload(null))).status).toBe(400)
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit).method === 'PUT')).toBe(
      false,
    )
  })
})

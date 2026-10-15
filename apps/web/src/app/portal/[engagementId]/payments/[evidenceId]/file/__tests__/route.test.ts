import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { accessMock, getDbMock, readSessionMock, rowMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  getDbMock: vi.fn(),
  readSessionMock: vi.fn(),
  rowMock: vi.fn(),
}))

vi.mock('@/lib/portal/session', () => ({ readAndVerifyPortalSession: readSessionMock }))
vi.mock('@phynd/services/engagement-portal/portal-access', () => ({
  resolvePortalAccess: accessMock,
}))
vi.mock('@phynd/db', () => ({ getDb: getDbMock }))

import { GET } from '../route'

const KEY = `payment-evidence/${'a'.repeat(64)}.png`
const R2_ENV = {
  R2_BUCKET_NAME: 'phynd-crm-payment-evidence',
  R2_ENDPOINT_URL: 'https://example-account.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    engagementId: 'eng-1',
    clientVisible: true,
    status: 'verified',
    evidenceStorageKey: KEY,
    evidenceMime: 'image/png',
    ...overrides,
  }
}

const call = (engagementId = 'eng-1', evidenceId = 'pe-1') =>
  GET(new Request(`http://localhost/portal/${engagementId}/payments/${evidenceId}/file`), {
    params: Promise.resolve({ engagementId, evidenceId }),
  })

describe('GET /portal/[engagementId]/payments/[evidenceId]/file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(process.env, R2_ENV)
    const qb: Record<string, unknown> = {}
    for (const m of ['select', 'from', 'where', 'limit']) qb[m] = vi.fn(() => qb)
    // biome-ignore lint/suspicious/noThenProperty: awaitable query-builder stub
    qb.then = (resolve: (v: unknown) => void) => Promise.resolve(rowMock()).then(resolve)
    getDbMock.mockReturnValue({ select: vi.fn(() => qb) })
    readSessionMock.mockResolvedValue({ engagementId: 'eng-1', email: 'persona@example.invalid' })
    accessMock.mockResolvedValue({ status: 'granted' })
    rowMock.mockReturnValue([evidence()])
  })
  afterEach(() => {
    for (const key of Object.keys(R2_ENV)) delete process.env[key]
  })

  it('redirects a portal contact to a short-lived signed URL', async () => {
    const res = await call()
    expect(res.status).toBe(302)
    const url = new URL(res.headers.get('location') ?? '')
    expect(url.pathname).toBe(`/phynd-crm-payment-evidence/${KEY}`)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    ['no portal session', () => readSessionMock.mockResolvedValue(null)],
    [
      'a session for another engagement',
      () =>
        readSessionMock.mockResolvedValue({ engagementId: 'eng-2', email: 'x@example.invalid' }),
    ],
    ['a contact without portal access', () => accessMock.mockResolvedValue({ status: 'denied' })],
    [
      'a receipt of another engagement',
      () => rowMock.mockReturnValue([evidence({ engagementId: 'eng-2' })]),
    ],
    [
      'a receipt hidden from the client',
      () => rowMock.mockReturnValue([evidence({ clientVisible: false })]),
    ],
    ['a voided receipt', () => rowMock.mockReturnValue([evidence({ status: 'voided' })])],
    [
      'a payment without file',
      () => rowMock.mockReturnValue([evidence({ evidenceStorageKey: null })]),
    ],
    ['an unknown receipt', () => rowMock.mockReturnValue([])],
    ['storage not configured', () => delete process.env.R2_BUCKET_NAME],
  ])('answers 404 for %s', async (_case, arrange) => {
    arrange()
    const res = await call()
    expect(res.status).toBe(404)
    expect(res.headers.get('location')).toBeNull()
  })
})

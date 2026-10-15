import { beforeEach, describe, expect, it, vi } from 'vitest'

const { acceptMock, accessMock, getDbMock, readSessionMock } = vi.hoisted(() => ({
  acceptMock: vi.fn(),
  accessMock: vi.fn(),
  getDbMock: vi.fn(),
  readSessionMock: vi.fn(),
}))

vi.mock('@/lib/portal/session', () => ({ readAndVerifyPortalSession: readSessionMock }))
vi.mock('@phynd/db', () => ({ getDb: getDbMock }))
vi.mock('@phynd/db/schema', () => ({
  engagementArtifacts: {
    engagementId: 'engagementArtifacts.engagementId',
    id: 'engagementArtifacts.id',
    type: 'engagementArtifacts.type',
  },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
}))
vi.mock('@phynd/services', () => ({
  EngagementPortalSignoffService: vi.fn(() => ({ acceptDeliverable: acceptMock })),
}))
vi.mock('@phynd/services/engagement-portal/portal-access', () => ({
  resolvePortalAccess: accessMock,
}))

import { POST } from '../route'

function request() {
  const form = new FormData()
  form.set('artifactId', 'art-001')
  return new Request('http://localhost/portal/eng-001/signoff', { body: form, method: 'POST' })
}

const params = { params: Promise.resolve({ engagementId: 'eng-001' }) }

describe('POST /portal/[engagementId]/signoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const qb: Record<string, unknown> = {}
    for (const m of ['select', 'from', 'where', 'limit']) qb[m] = vi.fn(() => qb)
    // biome-ignore lint/suspicious/noThenProperty: awaitable query-builder stub
    qb.then = (resolve: (v: unknown) => void) => Promise.resolve([{ id: 'art-001' }]).then(resolve)
    getDbMock.mockReturnValue({ select: vi.fn(() => qb) })
    readSessionMock.mockResolvedValue({
      accessToken: 'janua-token',
      email: 'persona@example.invalid',
      engagementId: 'eng-001',
      expiresAt: Date.now() + 60_000,
      januaUserId: 'janua-001',
    })
  })

  it('records the acceptance for a portal contact of the engagement', async () => {
    accessMock.mockResolvedValue({ status: 'granted', engagement: {}, viewer: {} })
    const res = await POST(request(), params)
    expect(res.headers.get('location')).toBe('http://localhost/portal/eng-001?signoff=accepted')
    expect(accessMock).toHaveBeenCalledWith(expect.anything(), 'eng-001', 'persona@example.invalid')
    expect(acceptMock).toHaveBeenCalledTimes(1)
  })

  it('refuses an email whose portal access was removed', async () => {
    accessMock.mockResolvedValue({ status: 'denied', engagement: {} })
    const res = await POST(request(), params)
    expect(res.headers.get('location')).toBe(
      'http://localhost/portal/expired?reason=email-mismatch',
    )
    expect(acceptMock).not.toHaveBeenCalled()
  })
})

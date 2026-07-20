import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Spies + mocks — declared before the vi.mock factories that close over them
// ---------------------------------------------------------------------------
const mockPostRedditComment = vi.fn()
const mockResolveRedisUrl = vi.fn(() => 'redis://localhost:6379')
const redisCtor = vi.fn()
const redisExists = vi.fn()
const redisSet = vi.fn()
const redisQuit = vi.fn()

const mockQb = {
  _result: [] as unknown[],
  from: vi.fn(() => mockQb),
  where: vi.fn(() => mockQb),
  set: vi.fn(() => mockQb),
  // biome-ignore lint/suspicious/noThenProperty: mock needs `then` to be awaitable
  then: vi.fn((resolve: (v: unknown) => void) => Promise.resolve(mockQb._result).then(resolve)),
}
const mockDb = {
  select: vi.fn(() => mockQb),
  update: vi.fn(() => mockQb),
}

vi.mock('@phynd/db', () => ({ getDb: () => mockDb }))
vi.mock('@phynd/db/schema', () => ({
  campaigns: { id: 'campaigns.id', status: 'campaigns.status', tulanaMetadata: 'campaigns.tulana' },
}))
vi.mock('@phynd/services', () => ({
  postRedditComment: (...args: unknown[]) => mockPostRedditComment(...args),
}))
vi.mock('@phynd/config/connections', () => ({
  resolveRedisUrl: () => mockResolveRedisUrl(),
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
}))
vi.mock('ioredis', () => ({
  default: class MockRedis {
    exists = redisExists
    set = redisSet
    quit = redisQuit
    constructor(url?: unknown, options?: unknown) {
      redisCtor(url, options)
    }
  },
}))

const REDDIT_URL = 'https://www.reddit.com/r/DerechoMexicano/comments/abc123/my_post/'

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'campaign-x',
    description:
      'DRAFT PENDING APPROVAL:\n\nHola, aquí tienes contexto legal.\n\n---\nTezca Evidence:\nArt 48',
    status: 'draft',
    utmSource: REDDIT_URL,
    tulanaMetadata: { fortuna_signal_id: 'sig_reddit_deadbeef1234' },
    ...overrides,
  }
}

function draftActionReq(body: unknown) {
  return new Request('http://localhost/api/campaigns/drafts/action', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/campaigns/drafts/action', () => {
  beforeEach(() => {
    mockQb._result = [makeCampaign()]
    mockPostRedditComment.mockResolvedValue({ success: true, commentUrl: 'https://reddit.com/c/1' })
    redisQuit.mockResolvedValue('OK')
    mockResolveRedisUrl.mockImplementation(() => 'redis://localhost:6379')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('passes the campaign fortuna_signal_id as the poster idempotency key', async () => {
    const { POST } = await import('@/app/api/campaigns/drafts/action/route')

    const res = await POST(draftActionReq({ id: 'campaign-x', action: 'approved' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, id: 'campaign-x', status: 'posted' })
    expect(mockPostRedditComment).toHaveBeenCalledWith(
      REDDIT_URL,
      expect.stringContaining('Hola'),
      expect.objectContaining({
        idempotencyKey: 'sig_reddit_deadbeef1234',
        hasPosted: expect.any(Function),
        recordPosted: expect.any(Function),
        checkRateLimit: expect.any(Function),
      }),
    )
    // Redis client is opened for the guards and closed afterward.
    expect(redisCtor).toHaveBeenCalledWith('redis://localhost:6379', expect.any(Object))
    expect(redisQuit).toHaveBeenCalled()
  })

  it('wires Redis-backed hasPosted/recordPosted/checkRateLimit hooks', async () => {
    const { POST } = await import('@/app/api/campaigns/drafts/action/route')
    await POST(draftActionReq({ id: 'campaign-x', action: 'approved' }))

    const options = mockPostRedditComment.mock.calls[0]?.[2] as {
      hasPosted: (k: string) => Promise<boolean>
      recordPosted: (k: string) => Promise<void>
      checkRateLimit: (b: string) => Promise<boolean>
    }

    // hasPosted → EXISTS on the namespaced posted key
    redisExists.mockResolvedValueOnce(1)
    await expect(options.hasPosted('sig_x')).resolves.toBe(true)
    expect(redisExists).toHaveBeenCalledWith('phynd:reddit:posted:sig_x')
    redisExists.mockResolvedValueOnce(0)
    await expect(options.hasPosted('sig_x')).resolves.toBe(false)

    // checkRateLimit → SET NX reservation; 'OK' means allowed, null means limited
    redisSet.mockResolvedValueOnce('OK')
    await expect(options.checkRateLimit('reddit:DerechoMexicano')).resolves.toBe(true)
    expect(redisSet).toHaveBeenCalledWith(
      'phynd:reddit:ratelimit:reddit:DerechoMexicano',
      '1',
      'EX',
      60,
      'NX',
    )
    redisSet.mockResolvedValueOnce(null)
    await expect(options.checkRateLimit('reddit:DerechoMexicano')).resolves.toBe(false)

    // recordPosted → durable SET with a TTL
    redisSet.mockResolvedValueOnce('OK')
    await options.recordPosted('sig_x')
    expect(redisSet).toHaveBeenCalledWith(
      'phynd:reddit:posted:sig_x',
      '1',
      'EX',
      expect.any(Number),
    )
  })

  it('omits the idempotency key when the campaign carries no fortuna_signal_id', async () => {
    mockQb._result = [makeCampaign({ tulanaMetadata: null })]
    const { POST } = await import('@/app/api/campaigns/drafts/action/route')

    await POST(draftActionReq({ id: 'campaign-x', action: 'approved' }))

    const options = mockPostRedditComment.mock.calls[0]?.[2] as Record<string, unknown>
    expect(options).not.toHaveProperty('idempotencyKey')
    // Redis guards are still wired.
    expect(options.hasPosted).toEqual(expect.any(Function))
  })

  it('degrades to in-memory guards when Redis cannot be resolved', async () => {
    mockResolveRedisUrl.mockImplementationOnce(() => {
      throw new Error('REDIS_URL is required in production')
    })
    const { POST } = await import('@/app/api/campaigns/drafts/action/route')

    const res = await POST(draftActionReq({ id: 'campaign-x', action: 'approved' }))
    const body = await res.json()

    expect(body.status).toBe('posted')
    // No Redis client constructed → no durable hooks, but the idempotency key
    // (from the campaign) is still passed so the poster's in-memory guard keys on it.
    expect(redisCtor).not.toHaveBeenCalled()
    const options = mockPostRedditComment.mock.calls[0]?.[2] as Record<string, unknown>
    expect(options).toMatchObject({ idempotencyKey: 'sig_reddit_deadbeef1234' })
    expect(options).not.toHaveProperty('hasPosted')
  })

  it('marks approved_pending_post and never posts when the campaign lacks a reddit URL', async () => {
    mockQb._result = [makeCampaign({ utmSource: null })]
    const { POST } = await import('@/app/api/campaigns/drafts/action/route')

    const res = await POST(draftActionReq({ id: 'campaign-x', action: 'approved' }))
    const body = await res.json()

    expect(body.status).toBe('approved_pending_post')
    expect(mockPostRedditComment).not.toHaveBeenCalled()
  })

  it('does not post on a rejection', async () => {
    const { POST } = await import('@/app/api/campaigns/drafts/action/route')

    const res = await POST(draftActionReq({ id: 'campaign-x', action: 'rejected' }))
    const body = await res.json()

    expect(body).toMatchObject({ success: true, id: 'campaign-x', status: 'rejected' })
    expect(mockPostRedditComment).not.toHaveBeenCalled()
  })

  it('returns 404 when the campaign does not exist', async () => {
    mockQb._result = []
    const { POST } = await import('@/app/api/campaigns/drafts/action/route')

    const res = await POST(draftActionReq({ id: 'missing', action: 'approved' }))

    expect(res.status).toBe(404)
    expect(mockPostRedditComment).not.toHaveBeenCalled()
  })

  it('returns 400 when id or action is missing', async () => {
    const { POST } = await import('@/app/api/campaigns/drafts/action/route')

    const res = await POST(draftActionReq({ action: 'approved' }))

    expect(res.status).toBe(400)
  })
})

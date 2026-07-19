import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildUserAgent,
  extractPostId,
  extractSubreddit,
  normalizeHandle,
  postRedditComment,
  resetRedditPosterState,
} from '../campaigns/reddit-poster'

describe('extractPostId', () => {
  it('extracts post ID from standard reddit URL', () => {
    const url = 'https://www.reddit.com/r/DerechoMexicano/comments/abc123/my_post_title/'
    expect(extractPostId(url)).toBe('t3_abc123')
  })

  it('extracts post ID from old.reddit.com URL', () => {
    const url = 'https://old.reddit.com/r/mexico/comments/xyz789/some_title/'
    expect(extractPostId(url)).toBe('t3_xyz789')
  })

  it('returns null for non-Reddit URLs', () => {
    expect(extractPostId('https://example.com/not-reddit')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractPostId('')).toBeNull()
  })

  it('handles URL without trailing slash', () => {
    const url = 'https://www.reddit.com/r/MexicoFinanciero/comments/def456'
    expect(extractPostId(url)).toBe('t3_def456')
  })
})

// ---------------------------------------------------------------------------
// Honest User-Agent — must identify the automated account, never spoof
// ---------------------------------------------------------------------------
describe('buildUserAgent (honest, identifying)', () => {
  it('defaults to the owned bot account and names the operator', () => {
    const ua = buildUserAgent()
    expect(ua).toBe('madfam-bot/1.0 (by /u/madfam-bot; +https://madfam.io)')
  })

  it('reflects the provided owned handle honestly', () => {
    expect(buildUserAgent('madfam_legal')).toBe(
      'madfam-bot/1.0 (by /u/madfam_legal; +https://madfam.io)',
    )
    // Leading u/ or /u/ is normalized so the UA stays well-formed.
    expect(buildUserAgent('u/madfam_legal')).toContain('by /u/madfam_legal;')
    expect(buildUserAgent('/u/madfam_legal')).toContain('by /u/madfam_legal;')
  })

  it('never impersonates a human/browser (no evasion strings)', () => {
    for (const ua of [buildUserAgent(), buildUserAgent('someone')]) {
      expect(ua).toContain('madfam-bot')
      expect(ua).toContain('+https://madfam.io')
      expect(ua).not.toMatch(/mozilla|chrome|safari|gecko|webkit/i)
    }
  })

  it('normalizeHandle strips u/ prefixes and falls back to the default', () => {
    expect(normalizeHandle('u/foo')).toBe('foo')
    expect(normalizeHandle('/u/foo')).toBe('foo')
    expect(normalizeHandle('')).toBe('madfam-bot')
    expect(normalizeHandle(undefined)).toBe('madfam-bot')
  })

  it('extractSubreddit pulls the subreddit for rate-limit bucketing', () => {
    expect(extractSubreddit('https://www.reddit.com/r/DerechoMexicano/comments/abc123/x/')).toBe(
      'DerechoMexicano',
    )
    expect(extractSubreddit('https://example.com/not-reddit')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// postRedditComment guards — idempotency + rate limiting (before the post)
// ---------------------------------------------------------------------------
describe('postRedditComment safety guards', () => {
  const POST_URL = 'https://www.reddit.com/r/DerechoMexicano/comments/abc123/my_post/'

  // Mock fetch: token endpoint → access token, comment endpoint → success.
  function mockRedditFetch() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/api/v1/access_token')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'tok-123',
            token_type: 'bearer',
            expires_in: 3600,
            scope: 'submit',
          }),
        } as Response
      }
      // /api/comment
      return {
        ok: true,
        json: async () => ({
          json: {
            errors: [],
            data: { things: [{ data: { permalink: '/r/x/comments/abc123/c/' } }] },
          },
        }),
      } as Response
    })
  }

  beforeEach(() => {
    resetRedditPosterState()
    vi.stubEnv('REDDIT_CLIENT_ID', 'cid')
    vi.stubEnv('REDDIT_CLIENT_SECRET', 'csecret')
    vi.stubEnv('REDDIT_REFRESH_TOKEN', 'rtoken')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetRedditPosterState()
  })

  it('posts successfully on the first call and sends an honest User-Agent', async () => {
    const fetchSpy = mockRedditFetch()

    const result = await postRedditComment(POST_URL, 'Hola', {
      idempotencyKey: 'sig_reddit_deadbeef1234',
      identity: { handle: 'madfam_legal', platform: 'reddit' },
    })

    expect(result.success).toBe(true)
    expect(result.commentUrl).toContain('reddit.com/r/x/comments/abc123/c/')
    // The comment POST must carry the identifying bot UA, not a browser UA.
    const commentCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/api/comment'))
    const headers = (commentCall?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['User-Agent']).toBe('madfam-bot/1.0 (by /u/madfam_legal; +https://madfam.io)')
  })

  it('is idempotent per signal id — a second reply to the same signal is skipped', async () => {
    const fetchSpy = mockRedditFetch()
    const opts = { idempotencyKey: 'sig_reddit_deadbeef1234', minIntervalMs: 0 }

    const first = await postRedditComment(POST_URL, 'Hola', opts)
    expect(first.success).toBe(true)

    // Even a different post URL under the same signal id must not double-post.
    const second = await postRedditComment(
      'https://www.reddit.com/r/Otro/comments/zzz999/other/',
      'Hola otra vez',
      opts,
    )
    expect(second.success).toBe(false)
    expect(second.skipped).toBe(true)

    const commentCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/comment'))
    expect(commentCalls).toHaveLength(1)
  })

  it('consults an injected durable dedup store before posting', async () => {
    const fetchSpy = mockRedditFetch()
    const hasPosted = vi.fn().mockResolvedValue(true)

    const result = await postRedditComment(POST_URL, 'Hola', {
      idempotencyKey: 'sig_reddit_already',
      hasPosted,
    })

    expect(hasPosted).toHaveBeenCalledWith('sig_reddit_already')
    expect(result.skipped).toBe(true)
    // Never reached the network when the durable store says "already posted".
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rate-limits a second post to the same subreddit within the interval', async () => {
    const fetchSpy = mockRedditFetch()

    const first = await postRedditComment(POST_URL, 'Uno', {
      idempotencyKey: 'sig_one',
      minIntervalMs: 60_000,
    })
    expect(first.success).toBe(true)

    // Different signal id, same subreddit, within the window → rate limited.
    const second = await postRedditComment(POST_URL, 'Dos', {
      idempotencyKey: 'sig_two',
      minIntervalMs: 60_000,
    })
    expect(second.success).toBe(false)
    expect(second.rateLimited).toBe(true)

    const commentCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/comment'))
    expect(commentCalls).toHaveLength(1)
  })

  it('honors an injected durable rate limiter', async () => {
    const fetchSpy = mockRedditFetch()
    const checkRateLimit = vi.fn().mockResolvedValue(false)

    const result = await postRedditComment(POST_URL, 'Hola', {
      idempotencyKey: 'sig_rl',
      minIntervalMs: 0,
      checkRateLimit,
    })

    expect(checkRateLimit).toHaveBeenCalledWith('reddit:DerechoMexicano')
    expect(result.rateLimited).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns an error without posting when the URL is not a Reddit post', async () => {
    const fetchSpy = mockRedditFetch()
    const result = await postRedditComment('https://example.com/x', 'Hola')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Could not extract post ID')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

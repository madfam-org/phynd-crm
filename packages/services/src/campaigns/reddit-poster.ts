/**
 * RedditPoster
 *
 * Handles Reddit OAuth2 (refresh token grant) and comment posting on behalf of
 * an owned MADFAM identity. Uses only native fetch — no external Reddit library.
 *
 * Safety guarantees:
 *   - Honest, identifying User-Agent (never impersonates a human or a browser).
 *   - Per-post idempotency keyed on the Fortuna signal id (or the target post
 *     URL) so the bot never replies twice to the same signal.
 *   - Conservative per-subreddit / per-platform rate limiting so outreach
 *     respects platform norms.
 *
 * Required env vars:
 *   REDDIT_CLIENT_ID       — App client ID from https://www.reddit.com/prefs/apps
 *   REDDIT_CLIENT_SECRET   — App secret
 *   REDDIT_REFRESH_TOKEN   — Long-lived refresh token (obtained via OAuth2 PKCE flow)
 */

const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const REDDIT_API_BASE = 'https://oauth.reddit.com'

/** Default owned Reddit account used when a payload carries no profile handle. */
const DEFAULT_BOT_HANDLE = 'madfam-bot'

/**
 * Conservative default: at most one reply per (platform, subreddit) bucket per
 * this interval. Callers may tighten/loosen via `minIntervalMs`, or plug a
 * durable limiter via `checkRateLimit`.
 */
const DEFAULT_MIN_INTERVAL_MS = 60_000

interface RedditTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

export interface PostResult {
  success: boolean
  commentUrl?: string
  error?: string
  /** True when the post was intentionally skipped (idempotency duplicate). */
  skipped?: boolean
  /** True when the post was blocked by the rate limiter. */
  rateLimited?: boolean
}

export interface PostRedditCommentOptions {
  /**
   * Signal-level idempotency key (the Fortuna `fortuna_signal_id`). Falls back
   * to the target post URL when omitted, so the bot never double-replies.
   */
  idempotencyKey?: string
  /**
   * Owned posting identity. `handle` is reflected honestly in the User-Agent;
   * `platform` scopes the rate-limit bucket. Credential selection is Reddit-only
   * today (only Reddit OAuth env vars are wired).
   */
  identity?: { handle?: string; platform?: string }
  /**
   * Optional durable dedup store (e.g. Redis / a posts table). Return true when
   * this key has already been posted. Layered on top of the in-memory guard.
   */
  hasPosted?: (key: string) => Promise<boolean> | boolean
  /** Persist that this key has posted (durable store). Best-effort. */
  recordPosted?: (key: string) => Promise<void> | void
  /**
   * Optional durable rate-limit check for a bucket. Return true when a post is
   * allowed. Layered on top of the in-memory limiter.
   */
  checkRateLimit?: (bucket: string) => Promise<boolean> | boolean
  /** Override the conservative in-memory min-interval per bucket (ms). */
  minIntervalMs?: number
}

// ---------------------------------------------------------------------------
// In-memory guards (per-process). A durable store can be layered via options;
// these defaults keep the poster safe even when no store is injected.
// ---------------------------------------------------------------------------
const postedKeys = new Set<string>()
const lastPostAtByBucket = new Map<string, number>()

/** Reset the in-memory idempotency + rate-limit state (test isolation). */
export function resetRedditPosterState(): void {
  postedKeys.clear()
  lastPostAtByBucket.clear()
}

/**
 * Normalize a handle to a bare account name (strip a leading `u/` or `/u/`).
 * Falls back to the default owned bot account.
 */
export function normalizeHandle(handle?: string | null): string {
  if (!handle) return DEFAULT_BOT_HANDLE
  const bare = handle.replace(/^\/?u\//i, '').trim()
  return bare || DEFAULT_BOT_HANDLE
}

/**
 * Build the identifying User-Agent. It honestly names the automated account and
 * its operator per Reddit API policy. This is NOT spoofing — do not add browser
 * strings or any detection-evasion here.
 */
export function buildUserAgent(handle?: string | null): string {
  return `madfam-bot/1.0 (by /u/${normalizeHandle(handle)}; +https://madfam.io)`
}

/** Default identifying User-Agent for the owned bot account. */
const USER_AGENT = buildUserAgent()

/** Extract the subreddit name from a Reddit post URL, or null. */
export function extractSubreddit(url: string): string | null {
  const match = url.match(/\/r\/([^/]+)/i)
  return match?.[1] ?? null
}

/**
 * Fetch a short-lived access token using the stored refresh token.
 */
async function getAccessToken(userAgent: string = USER_AGENT): Promise<string> {
  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  const refreshToken = process.env.REDDIT_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Reddit OAuth credentials not configured. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN.',
    )
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Reddit token fetch failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as RedditTokenResponse
  return data.access_token
}

/**
 * Extract the Reddit post fullname (e.g. "t3_abc123") from a post URL.
 * Reddit URL formats:
 *   https://old.reddit.com/r/subreddit/comments/POST_ID/title/
 *   https://www.reddit.com/r/subreddit/comments/POST_ID/title/
 */
export function extractPostId(url: string): string | null {
  const match = url.match(/\/r\/[^/]+\/comments\/([a-z0-9]+)/i)
  if (!match || !match[1]) return null
  return `t3_${match[1]}` // Reddit "fullname" for a link/post
}

/**
 * Idempotency guard. Returns a skip result when this key was already posted —
 * checked against the in-memory set first, then the optional durable store — or
 * null to continue. Never reply twice to the same signal/post.
 */
async function idempotencyGuard(
  idempotencyKey: string,
  hasPosted?: PostRedditCommentOptions['hasPosted'],
): Promise<PostResult | null> {
  const duplicate: PostResult = {
    success: false,
    skipped: true,
    error: `Duplicate: already replied for ${idempotencyKey}`,
  }
  if (postedKeys.has(idempotencyKey)) return duplicate
  if (hasPosted) {
    try {
      if (await hasPosted(idempotencyKey)) return duplicate
    } catch {
      // Durable store failure → fall back to the in-memory guard only.
    }
  }
  return null
}

/**
 * Rate-limit guard. Returns a rate-limited result when the bucket is posting too
 * fast — checked against the in-memory min-interval first, then the optional
 * durable limiter — or null to continue. Respect platform norms.
 */
async function rateLimitGuard(
  bucket: string,
  minIntervalMs: number,
  checkRateLimit?: PostRedditCommentOptions['checkRateLimit'],
): Promise<PostResult | null> {
  const limited: PostResult = {
    success: false,
    rateLimited: true,
    error: `Rate limited for ${bucket}`,
  }
  const lastAt = lastPostAtByBucket.get(bucket)
  if (lastAt !== undefined && Date.now() - lastAt < minIntervalMs) return limited
  if (checkRateLimit) {
    try {
      if (!(await checkRateLimit(bucket))) return limited
    } catch {
      // Durable limiter failure → rely on the in-memory limiter above.
    }
  }
  return null
}

/**
 * Post a top-level comment reply to a Reddit post as an owned MADFAM identity.
 *
 * Idempotency and rate-limit guards run BEFORE any network call so the bot
 * never double-replies to the same signal and always respects platform norms.
 *
 * @param postUrl      - Full URL of the Reddit post to reply to
 * @param markdownText - Markdown content of the reply
 * @param options      - Idempotency key, posting identity, and optional durable
 *                       dedup/rate-limit stores
 */
export async function postRedditComment(
  postUrl: string,
  markdownText: string,
  options: PostRedditCommentOptions = {},
): Promise<PostResult> {
  const thingId = extractPostId(postUrl)
  if (!thingId) {
    return { success: false, error: `Could not extract post ID from URL: ${postUrl}` }
  }

  const userAgent = buildUserAgent(options.identity?.handle)
  const platform = options.identity?.platform ?? 'reddit'
  const subreddit = extractSubreddit(postUrl) ?? 'unknown'
  const bucket = `${platform}:${subreddit}`
  const idempotencyKey = options.idempotencyKey ?? postUrl

  // Never reply twice to the same signal; always respect platform norms. Both
  // guards run before any network call.
  const duplicate = await idempotencyGuard(idempotencyKey, options.hasPosted)
  if (duplicate) return duplicate

  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const rateLimited = await rateLimitGuard(bucket, minIntervalMs, options.checkRateLimit)
  if (rateLimited) return rateLimited

  let accessToken: string
  try {
    accessToken = await getAccessToken(userAgent)
  } catch (e) {
    return { success: false, error: `OAuth failed: ${String(e)}` }
  }

  const res = await fetch(`${REDDIT_API_BASE}/api/comment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: new URLSearchParams({
      api_type: 'json',
      thing_id: thingId,
      text: markdownText,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    return { success: false, error: `Reddit comment POST failed (${res.status}): ${body}` }
  }

  const data = (await res.json()) as {
    json: { errors: string[][]; data?: { things: Array<{ data: { permalink: string } }> } }
  }

  if (data.json.errors && data.json.errors.length > 0) {
    return { success: false, error: `Reddit API error: ${JSON.stringify(data.json.errors)}` }
  }

  // Post succeeded — record for idempotency + rate limiting so retries and
  // concurrent triggers can't produce a second reply.
  postedKeys.add(idempotencyKey)
  lastPostAtByBucket.set(bucket, Date.now())
  if (options.recordPosted) {
    try {
      await options.recordPosted(idempotencyKey)
    } catch {
      // Best-effort durable persist; the in-memory guard already recorded it.
    }
  }

  const permalink = data.json.data?.things?.[0]?.data?.permalink
  const commentUrl = permalink ? `https://www.reddit.com${permalink}` : undefined

  return { success: true, commentUrl }
}

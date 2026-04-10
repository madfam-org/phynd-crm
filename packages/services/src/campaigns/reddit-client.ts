/**
 * RedditClient
 *
 * OAuth2 "script" app client for polling subreddits and reading posts.
 * Uses password grant (script-type apps) for automated worker polling.
 * All requests use native fetch with proper User-Agent and rate limiting.
 *
 * Required env vars:
 *   REDDIT_CLIENT_ID      — App client ID from https://www.reddit.com/prefs/apps
 *   REDDIT_CLIENT_SECRET   — App secret
 *   REDDIT_USERNAME        — Bot account username
 *   REDDIT_PASSWORD        — Bot account password
 *   REDDIT_USER_AGENT      — e.g. "madfam-bot/1.0 (by /u/madfam-bot; +https://madfam.io)"
 */

const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const REDDIT_API_BASE = 'https://oauth.reddit.com'

/** Minimum delay between API calls to stay within Reddit's 60 req/min limit */
const RATE_LIMIT_DELAY_MS = 1_100

interface RedditTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

export interface RedditPost {
  /** Short ID (e.g. "abc123") */
  id: string
  /** Reddit fullname for API calls (e.g. "t3_abc123") */
  fullname: string
  title: string
  selftext: string
  author: string
  subreddit: string
  url: string
  permalink: string
  created_utc: number
  num_comments: number
  score: number
}

interface RedditListingChild {
  kind: string
  data: {
    id: string
    name: string
    title: string
    selftext: string
    author: string
    subreddit: string
    url: string
    permalink: string
    created_utc: number
    num_comments: number
    score: number
  }
}

interface RedditListingResponse {
  kind: string
  data: {
    children: RedditListingChild[]
    after: string | null
    before: string | null
  }
}

interface RedditUserListingChild {
  kind: string
  data: {
    parent_id: string
    link_id: string
    body: string
    author: string
    created_utc: number
  }
}

interface RedditUserListingResponse {
  kind: string
  data: {
    children: RedditUserListingChild[]
    after: string | null
  }
}

export class RedditClient {
  private accessToken: string | null = null
  private tokenExpiresAt = 0
  private lastRequestAt = 0

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly userAgent: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  /**
   * Authenticate using OAuth2 password grant (script-type app).
   * Caches the token and refreshes when expired (with 60s safety margin).
   */
  async authenticate(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')

    const res = await fetch(REDDIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: this.username,
        password: this.password,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Reddit OAuth2 token request failed (${res.status}): ${body}`)
    }

    const data = (await res.json()) as RedditTokenResponse

    if (!data.access_token) {
      throw new Error('Reddit OAuth2 response missing access_token')
    }

    this.accessToken = data.access_token
    // Expire 60 seconds early to avoid edge-case failures
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000
  }

  /**
   * Fetch new posts from a subreddit, sorted by "new".
   * Optionally filter to posts created within `maxAgeHours`.
   */
  async getNewPosts(subreddit: string, limit = 25, maxAgeHours = 2): Promise<RedditPost[]> {
    await this.authenticate()
    await this.rateLimit()

    const url = `${REDDIT_API_BASE}/r/${encodeURIComponent(subreddit)}/new.json?limit=${limit}&raw_json=1`

    const res = await fetch(url, {
      method: 'GET',
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Reddit GET /r/${subreddit}/new failed (${res.status}): ${body}`)
    }

    const listing = (await res.json()) as RedditListingResponse
    const cutoff = Date.now() / 1000 - maxAgeHours * 3600

    return listing.data.children
      .filter((child) => child.data.created_utc >= cutoff)
      .map((child) => ({
        id: child.data.id,
        fullname: child.data.name,
        title: child.data.title,
        selftext: child.data.selftext,
        author: child.data.author,
        subreddit: child.data.subreddit,
        url: child.data.url,
        permalink: `https://www.reddit.com${child.data.permalink}`,
        created_utc: child.data.created_utc,
        num_comments: child.data.num_comments,
        score: child.data.score,
      }))
  }

  /**
   * Check if the bot account has already commented on a given post.
   * Scans the bot's recent comment history (last 100 comments) for
   * a comment whose `link_id` matches the post fullname.
   */
  async hasReplied(postFullname: string): Promise<boolean> {
    await this.authenticate()
    await this.rateLimit()

    const url = `${REDDIT_API_BASE}/user/${encodeURIComponent(this.username)}/comments.json?limit=100&raw_json=1`

    const res = await fetch(url, {
      method: 'GET',
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      // If we cannot check, be conservative and assume we already replied
      return true
    }

    const listing = (await res.json()) as RedditUserListingResponse

    return listing.data.children.some((child) => child.data.link_id === postFullname)
  }

  /**
   * Post a comment reply on a given thing (post or comment).
   *
   * NOTE: This method exists for completeness but the reddit-bot processor
   * does NOT call it. Comments are staged as CRM campaign drafts for
   * human-in-the-loop approval. The `reddit-poster.ts` module handles
   * actual posting after approval.
   */
  async postComment(parentFullname: string, text: string): Promise<{ id: string }> {
    await this.authenticate()
    await this.rateLimit()

    const res = await fetch(`${REDDIT_API_BASE}/api/comment`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        api_type: 'json',
        thing_id: parentFullname,
        text,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Reddit POST /api/comment failed (${res.status}): ${body}`)
    }

    const data = (await res.json()) as {
      json: {
        errors: string[][]
        data?: { things: Array<{ data: { id: string } }> }
      }
    }

    if (data.json.errors && data.json.errors.length > 0) {
      throw new Error(`Reddit API comment errors: ${JSON.stringify(data.json.errors)}`)
    }

    const commentId = data.json.data?.things?.[0]?.data?.id
    if (!commentId) {
      throw new Error('Reddit API did not return a comment ID')
    }

    return { id: commentId }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private authHeaders(): Record<string, string> {
    if (!this.accessToken) {
      throw new Error('RedditClient not authenticated — call authenticate() first')
    }
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'User-Agent': this.userAgent,
    }
  }

  /**
   * Enforce a minimum delay between outbound requests.
   * Reddit's rate limit is 60 requests/minute for OAuth apps.
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastRequestAt
    if (elapsed < RATE_LIMIT_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS - elapsed))
    }
    this.lastRequestAt = Date.now()
  }
}

/**
 * Factory: create a RedditClient from environment variables.
 * Throws immediately if required vars are missing.
 */
export function createRedditClientFromEnv(): RedditClient {
  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  const username = process.env.REDDIT_USERNAME
  const password = process.env.REDDIT_PASSWORD
  const userAgent =
    process.env.REDDIT_USER_AGENT ?? 'madfam-bot/1.0 (by /u/madfam-bot; +https://madfam.io)'

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error(
      'Reddit polling credentials not configured. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD.',
    )
  }

  return new RedditClient(clientId, clientSecret, userAgent, username, password)
}

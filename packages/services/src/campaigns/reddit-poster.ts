/**
 * RedditPoster
 *
 * Handles Reddit OAuth2 (refresh token grant) and comment posting on behalf of u/madfam-bot.
 * Uses only native fetch — no external Reddit library needed.
 *
 * Required env vars:
 *   REDDIT_CLIENT_ID       — App client ID from https://www.reddit.com/prefs/apps
 *   REDDIT_CLIENT_SECRET   — App secret
 *   REDDIT_REFRESH_TOKEN   — Long-lived refresh token (obtained via OAuth2 PKCE flow)
 */

const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const REDDIT_API_BASE = 'https://oauth.reddit.com'
const USER_AGENT = 'madfam-bot/1.0 (by /u/madfam-bot; +https://madfam.io)'

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
}

/**
 * Fetch a short-lived access token using the stored refresh token.
 */
async function getAccessToken(): Promise<string> {
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
      'User-Agent': USER_AGENT,
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
 * Post a top-level comment reply to a Reddit post as u/madfam-bot.
 *
 * @param postUrl     - Full URL of the Reddit post to reply to
 * @param markdownText - Markdown content of the reply
 */
export async function postRedditComment(
  postUrl: string,
  markdownText: string,
): Promise<PostResult> {
  const thingId = extractPostId(postUrl)
  if (!thingId) {
    return { success: false, error: `Could not extract post ID from URL: ${postUrl}` }
  }

  let accessToken: string
  try {
    accessToken = await getAccessToken()
  } catch (e) {
    return { success: false, error: `OAuth failed: ${String(e)}` }
  }

  const res = await fetch(`${REDDIT_API_BASE}/api/comment`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
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

  const permalink = data.json.data?.things?.[0]?.data?.permalink
  const commentUrl = permalink ? `https://www.reddit.com${permalink}` : undefined

  return { success: true, commentUrl }
}

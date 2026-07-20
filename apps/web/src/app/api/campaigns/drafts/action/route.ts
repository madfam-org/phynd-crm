import { resolveRedisUrl } from '@phynd/config/connections'
import { getDb } from '@phynd/db'
import { campaigns } from '@phynd/db/schema'
import { postRedditComment } from '@phynd/services'
import { eq } from 'drizzle-orm'
import Redis from 'ioredis'
import { NextResponse } from 'next/server'

type Db = ReturnType<typeof getDb>
type DraftAction = 'approved' | 'rejected'
type DraftActionBody = {
  id?: string
  action?: DraftAction
}

// Durable poster guards live in Redis, NOT a posts table — a Drizzle migration
// would collide with 0014. Keys are namespaced + TTL'd so the store stays
// bounded while still preventing double-replies across process restarts.
const POSTED_KEY_PREFIX = 'phynd:reddit:posted:'
const RATE_LIMIT_KEY_PREFIX = 'phynd:reddit:ratelimit:'
const POSTED_TTL_SECONDS = 60 * 60 * 24 * 180 // 180-day idempotency window
const RATE_LIMIT_WINDOW_SECONDS = 60 // ≤ 1 reply per (platform:subreddit) bucket / min

function draftTextFromDescription(description?: string | null) {
  const descriptionParts = description?.split('---\nTezca Evidence:') ?? []
  return descriptionParts[0]?.replace('DRAFT PENDING APPROVAL:\n\n', '').trim() ?? ''
}

/**
 * Read the Fortuna master join key threaded onto the campaign's existing
 * `tulanaMetadata` jsonb (zero-migration). Used as the poster idempotency key so
 * approving the same signal twice never produces a second reply.
 */
function fortunaSignalIdOf(tulanaMetadata: unknown): string | undefined {
  if (tulanaMetadata && typeof tulanaMetadata === 'object') {
    const value = (tulanaMetadata as Record<string, unknown>).fortuna_signal_id
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * Best-effort Redis client for the durable poster guards. Returns null when
 * REDIS_URL can't be resolved/constructed so posting degrades to the poster's
 * in-memory guards instead of failing the approval.
 */
function createRedisClient(): Redis | null {
  try {
    return new Redis(resolveRedisUrl(), { maxRetriesPerRequest: 1, lazyConnect: true })
  } catch (err) {
    console.warn('Redis unavailable for reddit poster guards — using in-memory guards:', err)
    return null
  }
}

/**
 * Redis-backed durable dedup + rate-limit hooks layered on top of the poster's
 * in-memory guards. Any Redis error is swallowed inside postRedditComment, which
 * then falls back to those in-memory guards.
 */
function redisPosterGuards(redis: Redis) {
  return {
    hasPosted: async (key: string) => (await redis.exists(`${POSTED_KEY_PREFIX}${key}`)) > 0,
    recordPosted: async (key: string) => {
      await redis.set(`${POSTED_KEY_PREFIX}${key}`, '1', 'EX', POSTED_TTL_SECONDS)
    },
    // SET NX reserves the bucket for the window; a successful reservation means
    // this is the first post in the window, so the post is allowed.
    checkRateLimit: async (bucket: string) => {
      const reserved = await redis.set(
        `${RATE_LIMIT_KEY_PREFIX}${bucket}`,
        '1',
        'EX',
        RATE_LIMIT_WINDOW_SECONDS,
        'NX',
      )
      return reserved === 'OK'
    },
  }
}

async function approveDraftCampaign(db: Db, id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id))

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const draftText = draftTextFromDescription(campaign.description)
  const redditPostUrl = campaign.utmSource ?? ''
  let finalStatus = 'approved'
  let commentUrl: string | undefined

  if (redditPostUrl && draftText) {
    console.log(`Posting to Reddit: ${redditPostUrl}`)
    // Idempotency key = the campaign's Fortuna join key so an approve retry (or a
    // concurrent trigger) can never post the same signal twice.
    const idempotencyKey = fortunaSignalIdOf(campaign.tulanaMetadata)
    const redis = createRedisClient()
    try {
      const result = await postRedditComment(redditPostUrl, draftText, {
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(redis ? redisPosterGuards(redis) : {}),
      })

      if (result.success) {
        finalStatus = 'posted'
        commentUrl = result.commentUrl
        console.log(`✓ Posted to Reddit: ${commentUrl}`)
      } else {
        finalStatus = 'approved_pending_post'
        console.error(`Reddit post failed: ${result.error}`)
      }
    } finally {
      if (redis) {
        await redis.quit().catch(() => {})
      }
    }
  } else {
    finalStatus = 'approved_pending_post'
    console.warn(`Campaign ${id} approved but missing Reddit URL or draft text.`)
  }

  await db.update(campaigns).set({ status: finalStatus }).where(eq(campaigns.id, id))

  return NextResponse.json({
    success: true,
    id,
    status: finalStatus,
    ...(commentUrl && { commentUrl }),
  })
}

async function rejectDraftCampaign(db: Db, id: string, action: DraftAction) {
  await db.update(campaigns).set({ status: action }).where(eq(campaigns.id, id))
  return NextResponse.json({ success: true, id, status: action })
}

export async function POST(req: Request) {
  try {
    const { id, action } = (await req.json()) as DraftActionBody

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 })
    }

    const db = getDb()

    if (action === 'approved') {
      return approveDraftCampaign(db, id)
    }

    return rejectDraftCampaign(db, id, action)
  } catch (error) {
    console.error('Draft action failed:', error)
    return NextResponse.json({ error: 'Failed to process campaign action' }, { status: 500 })
  }
}

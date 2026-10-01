import type { Database } from '@phynd/db'
import { users } from '@phynd/db/schema'
import { eq } from 'drizzle-orm'

/** How long a resolution (linked or not) is reused before the DB is asked again. */
export const CRM_USER_CACHE_TTL_MS = 30_000
const DEFAULT_MAX_ENTRIES = 1_000

interface CacheEntry {
  crmUserId: string | null
  expiresAt: number
}

export interface CrmUserResolverOptions {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

type UsersLookupDb = Pick<Database, 'select'>

/**
 * Resolves a Janua subject to the CRM `users.id` linked through
 * `users.external_janua_id`. Results, including "not linked", are cached per
 * tenant and subject for a short TTL so a request costs at most one lookup.
 *
 * `users.linkJanua` / `unlinkJanua` invalidate the entry in this process; other
 * replicas pick the change up when their entry expires.
 */
export class CrmUserResolver {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: CrmUserResolverOptions = {}) {
    this.ttlMs = options.ttlMs ?? CRM_USER_CACHE_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.now = options.now ?? Date.now
  }

  async resolve(db: UsersLookupDb, tenantId: string, januaSub: string): Promise<string | null> {
    if (!januaSub) return null
    const key = cacheKey(tenantId, januaSub)
    const hit = this.cache.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.crmUserId

    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalJanuaId, januaSub))
      .limit(1)
    const crmUserId = row?.id ?? null
    this.store(key, crmUserId)
    return crmUserId
  }

  invalidate(tenantId: string, januaSub: string) {
    this.cache.delete(cacheKey(tenantId, januaSub))
  }

  clear() {
    this.cache.clear()
  }

  get size() {
    return this.cache.size
  }

  private store(key: string, crmUserId: string | null) {
    this.cache.delete(key)
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(key, { crmUserId, expiresAt: this.now() + this.ttlMs })
  }
}

function cacheKey(tenantId: string, januaSub: string) {
  return `${tenantId}\u0000${januaSub}`
}

/** Process-wide resolver shared by request contexts and the users service. */
export const crmUserResolver = new CrmUserResolver()

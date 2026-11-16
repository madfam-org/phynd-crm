import type { Database } from '@phynd/db'
import { users } from '@phynd/db/schema'
import { eq } from 'drizzle-orm'

/** How long a resolution (linked or not) is reused before the DB is asked again. */
export const CRM_USER_CACHE_TTL_MS = 30_000
const DEFAULT_MAX_ENTRIES = 1_000

/** The CRM user linked to a Janua subject: its id and its role (`users.role`). */
export interface LinkedCrmUser {
  id: string
  role: string
}

interface CacheEntry {
  user: LinkedCrmUser | null
  expiresAt: number
}

export interface CrmUserResolverOptions {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

type UsersLookupDb = Pick<Database, 'select'>

/**
 * Resolves a Janua subject to the CRM user linked through
 * `users.external_janua_id`: its `users.id` and its `users.role`, which is the
 * staff session's only role. Results, including "not linked", are cached per
 * tenant and subject for a short TTL so a request costs at most one lookup.
 *
 * `users.linkJanua` / `unlinkJanua` / `update` / `delete` invalidate the entry
 * in this process; other replicas pick the change up when their entry expires
 * (at most {@link CRM_USER_CACHE_TTL_MS}).
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

  /** The linked CRM user's id, or null. */
  async resolve(db: UsersLookupDb, tenantId: string, januaSub: string): Promise<string | null> {
    return (await this.resolveUser(db, tenantId, januaSub))?.id ?? null
  }

  /** The linked CRM user (id and role), or null. */
  async resolveUser(
    db: UsersLookupDb,
    tenantId: string,
    januaSub: string,
  ): Promise<LinkedCrmUser | null> {
    if (!januaSub) return null
    const key = cacheKey(tenantId, januaSub)
    const hit = this.cache.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.user

    const [row] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.externalJanuaId, januaSub))
      .limit(1)
    const user = row ? { id: row.id, role: row.role } : null
    this.store(key, user)
    return user
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

  private store(key: string, user: LinkedCrmUser | null) {
    this.cache.delete(key)
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(key, { user, expiresAt: this.now() + this.ttlMs })
  }
}

function cacheKey(tenantId: string, januaSub: string) {
  return `${tenantId}\u0000${januaSub}`
}

/** Process-wide resolver shared by request contexts and the users service. */
export const crmUserResolver = new CrmUserResolver()

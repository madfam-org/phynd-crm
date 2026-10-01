import { users } from '@phynd/db/schema'
import { createLogger } from '@phynd/logging'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { ConflictError, NotFoundError } from '../errors'
import { actorIdOf } from '../identity/actor'
import { crmUserResolver } from '../identity/crm-user-resolver'

const auditLogger = createLogger('services:users:janua-link')

type UserRow = typeof users.$inferSelect

/** Postgres unique_violation, possibly wrapped by Drizzle (`DrizzleQueryError.cause`). */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined; e; ) {
    if (e.code === '23505') return true
    e = e.cause as typeof e
  }
  return false
}

export class UsersService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(pagination?: PaginationInput): Promise<PaginatedResult<UserRow>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(users.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(users.id)
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async getById(id: string) {
    const [user] = await this.ctx.db.select().from(users).where(eq(users.id, id))
    return user ?? null
  }

  async getByJanuaId(januaId: string) {
    const [user] = await this.ctx.db.select().from(users).where(eq(users.externalJanuaId, januaId))
    return user ?? null
  }

  async create(data: { email: string; name?: string; role?: string; externalJanuaId?: string }) {
    const externalJanuaId = data.externalJanuaId || undefined
    if (externalJanuaId) await this.assertJanuaIdFree(externalJanuaId)

    let user: UserRow | undefined
    try {
      ;[user] = await this.ctx.db
        .insert(users)
        .values({ ...data, externalJanuaId })
        .returning()
    } catch (err) {
      if (externalJanuaId && isUniqueViolation(err)) throw januaIdTakenError()
      throw err
    }
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    const created = user!
    if (externalJanuaId) this.recordLinkChange('link', created.id, externalJanuaId)
    return created
  }

  async update(id: string, data: Partial<{ email: string; name: string | null; role: string }>) {
    const [user] = await this.ctx.db.update(users).set(data).where(eq(users.id, id)).returning()
    return user ?? null
  }

  async delete(id: string) {
    const [user] = await this.ctx.db.delete(users).where(eq(users.id, id)).returning()
    if (user?.externalJanuaId) crmUserResolver.invalidate(this.ctx.tenantId, user.externalJanuaId)
    return user ?? null
  }

  /**
   * Links a CRM user to a Janua subject (`users.external_janua_id`). Idempotent
   * for the same pair. A user already linked to another subject must be
   * unlinked first; a subject linked to another user is a conflict.
   */
  async linkJanua(id: string, januaSub: string) {
    const user = await this.getById(id)
    if (!user) throw new NotFoundError('User', id)
    if (user.externalJanuaId === januaSub) return user
    if (user.externalJanuaId) {
      throw new ConflictError(
        'This CRM user is already linked to a different Janua identity. Unlink it first.',
        { userId: id },
      )
    }
    await this.assertJanuaIdFree(januaSub, id)

    let updated: UserRow | undefined
    try {
      ;[updated] = await this.ctx.db
        .update(users)
        .set({ externalJanuaId: januaSub })
        .where(and(eq(users.id, id), isNull(users.externalJanuaId)))
        .returning()
    } catch (err) {
      if (isUniqueViolation(err)) throw januaIdTakenError()
      throw err
    }
    if (!updated) {
      throw new ConflictError('This CRM user was linked concurrently. Reload and try again.', {
        userId: id,
      })
    }
    this.recordLinkChange('link', id, januaSub)
    return updated
  }

  /** Removes the Janua link of a CRM user. Idempotent when it is not linked. */
  async unlinkJanua(id: string) {
    const user = await this.getById(id)
    if (!user) throw new NotFoundError('User', id)
    const previous = user.externalJanuaId
    if (!previous) return user

    const [updated] = await this.ctx.db
      .update(users)
      .set({ externalJanuaId: null })
      .where(eq(users.id, id))
      .returning()
    this.recordLinkChange('unlink', id, previous)
    return updated ?? { ...user, externalJanuaId: null }
  }

  private async assertJanuaIdFree(januaSub: string, exceptUserId?: string) {
    const holder = await this.getByJanuaId(januaSub)
    if (holder && holder.id !== exceptUserId) throw januaIdTakenError(holder.id)
  }

  /** Audit trail for link changes, and immediate cache invalidation in this process. */
  private recordLinkChange(action: 'link' | 'unlink', userId: string, januaSub: string) {
    crmUserResolver.invalidate(this.ctx.tenantId, januaSub)
    auditLogger.info(
      {
        event: 'users.janua_link',
        action,
        actor: actorIdOf(this.ctx.auth),
        tenantId: this.ctx.tenantId,
        userId,
        januaSub,
      },
      action === 'link'
        ? 'CRM user linked to Janua identity'
        : 'CRM user unlinked from Janua identity',
    )
  }
}

function januaIdTakenError(holderId?: string) {
  return new ConflictError(
    'This Janua identity is already linked to another CRM user. Unlink it there first.',
    holderId ? { userId: holderId } : undefined,
  )
}

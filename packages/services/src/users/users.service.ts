import { users } from '@phynd/db/schema'
import { createLogger } from '@phynd/logging'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
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
    // The role is the linked staff session's only role: drop the cached one so
    // the change applies on the next request in this process.
    if (user?.externalJanuaId) crmUserResolver.invalidate(this.ctx.tenantId, user.externalJanuaId)
    return user ?? null
  }

  /**
   * First-sign-in provisioning for a bootstrap-listed staff account (see
   * `PHYND_BOOTSTRAP_STAFF` in the web app). Returns the CRM user now linked to
   * `januaSub`, or null when it is refused (the reason is logged with the
   * subject and role, never the email).
   *
   * - A user already linked to `januaSub` is returned unchanged.
   * - `linkByEmail` (the entry matched a verified email): a single unlinked CRM
   *   user with that email (case-insensitive) is linked and given `role`;
   *   several unlinked ones, or one linked to another subject, refuse.
   * - Otherwise a CRM user is created with `role`, linked to `januaSub`.
   */
  async bootstrapStaff(input: {
    januaSub: string
    email: string
    name?: string | null
    role: string
    linkByEmail: boolean
  }): Promise<UserRow | null> {
    const existing = await this.getByJanuaId(input.januaSub)
    if (existing) return existing

    if (input.linkByEmail) {
      const sameEmail = await this.ctx.db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${input.email.trim().toLowerCase()}`)
      if (sameEmail.some((u) => u.externalJanuaId && u.externalJanuaId !== input.januaSub)) {
        this.recordBootstrapRefusal('email_linked_to_another_identity', input)
        return null
      }
      const unlinked = sameEmail.filter((u) => !u.externalJanuaId)
      if (unlinked.length > 1) {
        this.recordBootstrapRefusal('several_users_with_this_email', input)
        return null
      }
      const target = unlinked[0]
      if (target) return this.linkUnlinked(target.id, input.januaSub, input.role)
    }

    return this.create({
      email: input.email,
      name: input.name ?? undefined,
      role: input.role,
      externalJanuaId: input.januaSub,
    })
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
    return this.linkUnlinked(id, januaSub)
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

  /**
   * Links a CRM user that is still unlinked to `januaSub` (and sets `role` when
   * given) in one update guarded on `external_janua_id IS NULL`, so a user
   * linked meanwhile to another subject is never re-pointed.
   */
  private async linkUnlinked(id: string, januaSub: string, role?: string) {
    await this.assertJanuaIdFree(januaSub, id)
    let updated: UserRow | undefined
    try {
      ;[updated] = await this.ctx.db
        .update(users)
        .set(role ? { externalJanuaId: januaSub, role } : { externalJanuaId: januaSub })
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

  private recordBootstrapRefusal(reason: string, input: { januaSub: string; role: string }) {
    auditLogger.warn(
      {
        event: 'users.bootstrap_refused',
        reason,
        tenantId: this.ctx.tenantId,
        januaSub: input.januaSub,
        role: input.role,
      },
      'bootstrap: staff account not provisioned',
    )
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

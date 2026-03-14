import { users } from '@phyne/db/schema'
import type { PaginatedResult, PaginationInput } from '@phyne/types/crm'
import { and, eq, gt } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class UsersService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(pagination?: PaginationInput): Promise<PaginatedResult<typeof users.$inferSelect>> {
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
    const [user] = await this.ctx.db.insert(users).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return user!
  }

  async update(id: string, data: Partial<{ email: string; name: string | null; role: string }>) {
    const [user] = await this.ctx.db.update(users).set(data).where(eq(users.id, id)).returning()
    return user ?? null
  }

  async delete(id: string) {
    const [user] = await this.ctx.db.delete(users).where(eq(users.id, id)).returning()
    return user ?? null
  }
}

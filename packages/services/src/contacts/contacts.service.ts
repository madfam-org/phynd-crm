import { contacts } from '@phyne/db/schema'
import type { PaginatedResult, PaginationInput } from '@phyne/types/crm'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class ContactsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
    filters?: { ownerId?: string },
  ): Promise<PaginatedResult<typeof contacts.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(contacts.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(contacts.id, pagination.cursor))
    }
    if (filters?.ownerId) {
      conditions.push(eq(contacts.ownerId, filters.ownerId))
    }

    const rows = await this.ctx.db
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(contacts.id)
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
    const [contact] = await this.ctx.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
    return contact ?? null
  }

  async getByJanuaId(januaId: string) {
    const [contact] = await this.ctx.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.externalJanuaId, januaId), isNull(contacts.deletedAt)))
    return contact ?? null
  }

  async create(data: {
    name: string
    email?: string
    phone?: string
    company?: string
    externalJanuaId?: string
  }) {
    const [contact] = await this.ctx.db.insert(contacts).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return contact!
  }

  async update(
    id: string,
    data: Partial<{
      name: string
      email: string | null
      phone: string | null
      company: string | null
      status: string
    }>,
  ) {
    const [contact] = await this.ctx.db
      .update(contacts)
      .set(data)
      .where(eq(contacts.id, id))
      .returning()
    return contact ?? null
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db
      .update(contacts)
      .set({ deletedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning()
    return deleted ?? null
  }
}

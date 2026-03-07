import { contacts } from '@phyne/db/schema'
import { eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class ContactsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list() {
    return this.ctx.db.select().from(contacts).orderBy(contacts.createdAt)
  }

  async getById(id: string) {
    const [contact] = await this.ctx.db.select().from(contacts).where(eq(contacts.id, id))
    return contact ?? null
  }

  async getByJanuaId(januaId: string) {
    const [contact] = await this.ctx.db
      .select()
      .from(contacts)
      .where(eq(contacts.externalJanuaId, januaId))
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
    const [deleted] = await this.ctx.db.delete(contacts).where(eq(contacts.id, id)).returning()
    return deleted ?? null
  }
}

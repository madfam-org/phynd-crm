import { notes } from '@phynd/db/schema'
import type { EntityType } from '@phynd/types/crm'
import { and, eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class NotesService {
  constructor(private readonly ctx: ServiceContext) {}

  async listForEntity(entityType: EntityType, entityId: string) {
    return this.ctx.db
      .select()
      .from(notes)
      .where(and(eq(notes.entityType, entityType), eq(notes.entityId, entityId)))
      .orderBy(notes.createdAt)
  }

  async create(data: {
    content: string
    entityType: EntityType
    entityId: string
    isPinned?: boolean
  }) {
    const [note] = await this.ctx.db
      .insert(notes)
      .values({
        ...data,
        authorId: this.ctx.auth.userId,
      })
      .returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return note!
  }

  async update(id: string, data: { content?: string }) {
    const [note] = await this.ctx.db
      .update(notes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(notes.id, id))
      .returning()
    return note ?? null
  }

  async delete(id: string) {
    const [note] = await this.ctx.db.delete(notes).where(eq(notes.id, id)).returning()
    return note ?? null
  }

  async togglePin(id: string) {
    const [existing] = await this.ctx.db.select().from(notes).where(eq(notes.id, id))
    if (!existing) return null

    const [note] = await this.ctx.db
      .update(notes)
      .set({ isPinned: !existing.isPinned, updatedAt: new Date() })
      .where(eq(notes.id, id))
      .returning()
    return note ?? null
  }
}

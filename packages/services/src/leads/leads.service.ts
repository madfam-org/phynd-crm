import { leads } from '@phyne/db/schema'
import { eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class LeadsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list() {
    return this.ctx.db.select().from(leads).orderBy(leads.createdAt)
  }

  async getById(id: string) {
    const [lead] = await this.ctx.db.select().from(leads).where(eq(leads.id, id))
    return lead ?? null
  }

  async create(data: {
    contactId?: string
    externalJanuaId?: string
    source?: string
    pipelineId: string
    stageId: string
  }) {
    const [lead] = await this.ctx.db.insert(leads).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return lead!
  }

  async update(
    id: string,
    data: Partial<{
      status: string
      score: number
      stageId: string
      ownerId: string
    }>,
  ) {
    const [lead] = await this.ctx.db.update(leads).set(data).where(eq(leads.id, id)).returning()
    return lead ?? null
  }

  async moveToStage(id: string, stageId: string) {
    return this.update(id, { stageId })
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db.delete(leads).where(eq(leads.id, id)).returning()
    return deleted ?? null
  }
}

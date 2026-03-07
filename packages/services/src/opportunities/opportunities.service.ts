import { opportunities } from '@phyne/db/schema'
import { eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class OpportunitiesService {
  constructor(private readonly ctx: ServiceContext) {}

  async list() {
    return this.ctx.db.select().from(opportunities).orderBy(opportunities.createdAt)
  }

  async getById(id: string) {
    const [opp] = await this.ctx.db.select().from(opportunities).where(eq(opportunities.id, id))
    return opp ?? null
  }

  async create(data: {
    name: string
    contactId?: string
    pipelineId: string
    stageId: string
    value?: string
    probability?: number
    expectedCloseDate?: Date
  }) {
    const [opp] = await this.ctx.db.insert(opportunities).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return opp!
  }

  async update(
    id: string,
    data: Partial<{
      name: string
      stageId: string
      value: string
      probability: number
      status: string
      expectedCloseDate: Date
    }>,
  ) {
    const [opp] = await this.ctx.db
      .update(opportunities)
      .set(data)
      .where(eq(opportunities.id, id))
      .returning()
    return opp ?? null
  }

  async moveToStage(id: string, stageId: string) {
    return this.update(id, { stageId })
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db
      .delete(opportunities)
      .where(eq(opportunities.id, id))
      .returning()
    return deleted ?? null
  }
}

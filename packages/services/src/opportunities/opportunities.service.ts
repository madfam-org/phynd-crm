import { conversions, opportunities, stageTransitions } from '@phyne/db/schema'
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
    const created = opp!

    // Auto-record lead_to_opportunity conversion
    await this.ctx.db.insert(conversions).values({
      type: 'lead_to_opportunity',
      contactId: data.contactId,
      opportunityId: created.id,
      value: data.value,
    })

    return created
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
    // Check for opportunity_to_won conversion
    if (data.status === 'won') {
      const current = await this.getById(id)
      if (current && current.status !== 'won') {
        await this.ctx.db.insert(conversions).values({
          type: 'opportunity_to_won',
          contactId: current.contactId,
          opportunityId: id,
          value: data.value ?? current.value,
        })
      }
    }

    const [opp] = await this.ctx.db
      .update(opportunities)
      .set(data)
      .where(eq(opportunities.id, id))
      .returning()
    return opp ?? null
  }

  async moveToStage(id: string, stageId: string) {
    const current = await this.getById(id)
    const result = await this.update(id, { stageId })

    // Record stage transition
    if (result) {
      await this.ctx.db.insert(stageTransitions).values({
        entityType: 'opportunity',
        entityId: id,
        fromStageId: current?.stageId ?? null,
        toStageId: stageId,
        transitionedBy: this.ctx.auth.userId || null,
      })
    }

    return result
  }

  async delete(id: string) {
    const [deleted] = await this.ctx.db
      .delete(opportunities)
      .where(eq(opportunities.id, id))
      .returning()
    return deleted ?? null
  }
}

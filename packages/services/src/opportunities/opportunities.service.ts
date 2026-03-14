import { conversions, opportunities, stageTransitions } from '@phyne/db/schema'
import type { PaginatedResult, PaginationInput } from '@phyne/types/crm'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class OpportunitiesService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof opportunities.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = [isNull(opportunities.deletedAt)]
    if (pagination?.cursor) {
      conditions.push(gt(opportunities.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(opportunities.id)
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
    const [opp] = await this.ctx.db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, id), isNull(opportunities.deletedAt)))
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
    const created = await this.ctx.db.transaction(async (tx) => {
      const [opp] = await tx.insert(opportunities).values(data).returning()
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
      const newOpp = opp!

      // Auto-record lead_to_opportunity conversion
      await tx.insert(conversions).values({
        type: 'lead_to_opportunity',
        contactId: data.contactId,
        opportunityId: newOpp.id,
        value: data.value,
      })

      return newOpp
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
    // When marking as won, wrap update + conversion in a transaction
    if (data.status === 'won') {
      const current = await this.getById(id)
      if (current && current.status !== 'won') {
        const [opp] = await this.ctx.db.transaction(async (tx) => {
          const [updated] = await tx
            .update(opportunities)
            .set(data)
            .where(eq(opportunities.id, id))
            .returning()

          await tx.insert(conversions).values({
            type: 'opportunity_to_won',
            contactId: current.contactId,
            opportunityId: id,
            value: data.value ?? current.value,
          })

          return [updated]
        })
        return opp ?? null
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
      .update(opportunities)
      .set({ deletedAt: new Date() })
      .where(eq(opportunities.id, id))
      .returning()
    return deleted ?? null
  }
}

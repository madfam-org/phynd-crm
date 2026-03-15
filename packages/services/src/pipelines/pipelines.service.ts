import { leads, opportunities, pipelineStages, pipelines } from '@phyne/db/schema'
import type { PaginatedResult, PaginationInput } from '@phyne/types/crm'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { ConflictError, ValidationError } from '../errors'

export class PipelinesService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<typeof pipelines.$inferSelect>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(gt(pipelines.id, pagination.cursor))
    }

    const rows = await this.ctx.db
      .select()
      .from(pipelines)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(pipelines.id)
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
    const [pipeline] = await this.ctx.db.select().from(pipelines).where(eq(pipelines.id, id))
    return pipeline ?? null
  }

  async getStages(pipelineId: string) {
    return this.ctx.db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipelineId))
      .orderBy(asc(pipelineStages.position))
  }

  async getDefault() {
    const [pipeline] = await this.ctx.db
      .select()
      .from(pipelines)
      .where(eq(pipelines.isDefault, true))
    return pipeline ?? null
  }

  async create(data: { name: string; isDefault?: boolean }) {
    return this.ctx.db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx.update(pipelines).set({ isDefault: false }).where(eq(pipelines.isDefault, true))
      }
      const [pipeline] = await tx
        .insert(pipelines)
        .values({ isDefault: data.isDefault ?? false, name: data.name })
        .returning()
      // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
      return pipeline!
    })
  }

  async update(id: string, data: { name?: string; isDefault?: boolean }) {
    return this.ctx.db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx.update(pipelines).set({ isDefault: false }).where(eq(pipelines.isDefault, true))
      }
      const [pipeline] = await tx
        .update(pipelines)
        .set(data)
        .where(eq(pipelines.id, id))
        .returning()
      return pipeline ?? null
    })
  }

  async delete(id: string) {
    const pipeline = await this.getById(id)
    if (!pipeline) return null

    if (pipeline.isDefault) {
      throw new ValidationError('Cannot delete the default pipeline')
    }

    // Check for referencing leads
    const [leadRef] = await this.ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.pipelineId, id))
    if (leadRef && leadRef.count > 0) {
      throw new ConflictError('Cannot delete pipeline: it has associated leads')
    }

    // Check for referencing opportunities
    const [oppRef] = await this.ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(eq(opportunities.pipelineId, id))
    if (oppRef && oppRef.count > 0) {
      throw new ConflictError('Cannot delete pipeline: it has associated opportunities')
    }

    const [deleted] = await this.ctx.db.delete(pipelines).where(eq(pipelines.id, id)).returning()
    return deleted ?? null
  }

  async createStage(data: {
    pipelineId: string
    name: string
    position: number
    probability?: number
  }) {
    const [stage] = await this.ctx.db.insert(pipelineStages).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return stage!
  }

  async updateStage(id: string, data: { name?: string; position?: number; probability?: number }) {
    const [stage] = await this.ctx.db
      .update(pipelineStages)
      .set(data)
      .where(eq(pipelineStages.id, id))
      .returning()
    return stage ?? null
  }

  async deleteStage(id: string) {
    // Check for referencing leads
    const [leadRef] = await this.ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.stageId, id))
    if (leadRef && leadRef.count > 0) {
      throw new ConflictError('Cannot delete stage: it has associated leads')
    }

    // Check for referencing opportunities
    const [oppRef] = await this.ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(eq(opportunities.stageId, id))
    if (oppRef && oppRef.count > 0) {
      throw new ConflictError('Cannot delete stage: it has associated opportunities')
    }

    const [deleted] = await this.ctx.db
      .delete(pipelineStages)
      .where(eq(pipelineStages.id, id))
      .returning()
    return deleted ?? null
  }

  async reorderStages(pipelineId: string, stageIds: string[]) {
    return this.ctx.db.transaction(async (tx) => {
      for (let i = 0; i < stageIds.length; i++) {
        const stageId = stageIds[i]
        if (!stageId) continue
        await tx
          .update(pipelineStages)
          .set({ position: i })
          .where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.pipelineId, pipelineId)))
      }
    })
  }
}

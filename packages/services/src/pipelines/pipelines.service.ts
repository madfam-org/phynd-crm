import { pipelineStages, pipelines } from '@phyne/db/schema'
import type { PaginatedResult, PaginationInput } from '@phyne/types/crm'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { ServiceContext } from '../context'

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
}

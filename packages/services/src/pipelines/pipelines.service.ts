import { pipelineStages, pipelines } from '@phyne/db/schema'
import { asc, eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class PipelinesService {
  constructor(private readonly ctx: ServiceContext) {}

  async list() {
    return this.ctx.db.select().from(pipelines).orderBy(pipelines.createdAt)
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

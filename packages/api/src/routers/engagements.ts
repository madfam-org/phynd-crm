import { EngagementsService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    contactId: z.string().optional(),
    status: z.string().optional(),
  })
  .optional()

export const engagementsRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const { contactId, status, ...pagination } = input ?? {}
    const service = new EngagementsService(ctx)
    return service.list(pagination, {
      ...(contactId ? { contactId } : {}),
      ...(status ? { status } : {}),
    })
  }),

  listByContactId: protectedProcedure
    .input(
      z.object({
        contactId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const { contactId, ...pagination } = input
      const service = new EngagementsService(ctx)
      return service.list(pagination, { contactId })
    }),

  getById: protectedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const service = new EngagementsService(ctx)
    return service.getById(input.id)
  }),

  create: protectedProcedure
    .input(
      z.object({
        contactId: z.string(),
        opportunityId: z.string().optional(),
        projectName: z.string().min(1).max(255),
        description: z.string().max(2000).optional(),
        status: z.string().optional(),
        ownerId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new EngagementsService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        projectName: z.string().min(1).max(255).optional(),
        description: z.string().max(2000).optional(),
        status: z.string().optional(),
        ownerId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new EngagementsService(ctx)
      return service.update(id, data)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const service = new EngagementsService(ctx)
      await service.delete(input.id)
      return { success: true }
    }),

  listArtifacts: protectedProcedure
    .input(z.object({ engagementId: z.string() }))
    .query(({ ctx, input }) => {
      const service = new EngagementsService(ctx)
      return service.listArtifacts(input.engagementId)
    }),

  addArtifact: protectedProcedure
    .input(
      z.object({
        engagementId: z.string(),
        type: z.string(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        url: z.string().url().optional(),
        title: z.string().max(255).optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new EngagementsService(ctx)
      return service.addArtifact(input)
    }),

  getTimeline: protectedProcedure
    .input(
      z.object({
        engagementId: z.string(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const service = new EngagementsService(ctx)
      return service.getTimeline(input.engagementId, input.limit)
    }),
})

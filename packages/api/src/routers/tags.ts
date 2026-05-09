import { TagsService } from '@phynd/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

export const tagsRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const service = new TagsService(ctx)
    return service.list(input ?? undefined)
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        color: z.string().max(7).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new TagsService(ctx)
      return service.create(input)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new TagsService(ctx)
      return service.delete(input.id)
    }),

  addToEntity: protectedProcedure
    .input(
      z.object({
        tagId: z.string().uuid(),
        entityType: z.enum(['contact', 'lead', 'opportunity', 'order', 'quote']),
        entityId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new TagsService(ctx)
      return service.addToEntity(input.tagId, input.entityType, input.entityId)
    }),

  removeFromEntity: protectedProcedure
    .input(
      z.object({
        tagId: z.string().uuid(),
        entityType: z.enum(['contact', 'lead', 'opportunity', 'order', 'quote']),
        entityId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new TagsService(ctx)
      return service.removeFromEntity(input.tagId, input.entityType, input.entityId)
    }),

  getForEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['contact', 'lead', 'opportunity', 'order', 'quote']),
        entityId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) => {
      const service = new TagsService(ctx)
      return service.getForEntity(input.entityType, input.entityId)
    }),
})

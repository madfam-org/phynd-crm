import { NotesService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

export const notesRouter = router({
  listForEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(['contact', 'lead', 'opportunity']),
        entityId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) => {
      const service = new NotesService(ctx)
      return service.listForEntity(input.entityType, input.entityId)
    }),

  create: protectedProcedure
    .input(
      z.object({
        content: z.string().min(1),
        entityType: z.enum(['contact', 'lead', 'opportunity']),
        entityId: z.string().uuid(),
        isPinned: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new NotesService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        content: z.string().min(1).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new NotesService(ctx)
      return service.update(id, data)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new NotesService(ctx)
      return service.delete(input.id)
    }),

  togglePin: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new NotesService(ctx)
      return service.togglePin(input.id)
    }),
})

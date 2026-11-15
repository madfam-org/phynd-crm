import { CASE_STATUSES, CASE_TYPES } from '@phynd/db/schema'
import { CasesService } from '@phynd/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const caseType = z.enum(CASE_TYPES)
const caseStatus = z.enum(CASE_STATUSES)

export const casesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          status: caseStatus.optional(),
          unresolved: z.boolean().optional(),
          ownerId: z.string().uuid().optional(),
          contactId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const { cursor, limit, ...filters } = input ?? {}
      return new CasesService(ctx).list({ cursor, limit }, filters)
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => new CasesService(ctx).getById(input.id)),

  create: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid(),
        type: caseType,
        summary: z.string().trim().min(1).max(5000),
        // Omitted: computed from the type.
        dueAt: z.date().optional(),
        ownerId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => new CasesService(ctx).create(input)),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        type: caseType.optional(),
        summary: z.string().trim().min(1).max(5000).optional(),
        status: caseStatus.optional(),
        dueAt: z.date().optional(),
        ownerId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      return new CasesService(ctx).update(id, data)
    }),
})

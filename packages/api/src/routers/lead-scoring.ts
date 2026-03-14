import { LeadScoringService } from '@phyne/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const scoringConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'contains', 'exists']),
  value: z.unknown().optional(),
})

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

export const leadScoringRouter = router({
  listRules: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const service = new LeadScoringService(ctx)
    return service.listRules(input ?? undefined)
  }),

  createRule: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        category: z.enum(['demographic', 'behavior', 'engagement']),
        condition: scoringConditionSchema,
        points: z.number().int(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new LeadScoringService(ctx)
      // biome-ignore lint/suspicious/noExplicitAny: zod infers narrower operator type than ScoringCondition
      return service.createRule(input as any)
    }),

  updateRule: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        category: z.enum(['demographic', 'behavior', 'engagement']).optional(),
        condition: scoringConditionSchema.optional(),
        points: z.number().int().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input
      const service = new LeadScoringService(ctx)
      return service.updateRule(id, data as Parameters<typeof service.updateRule>[1])
    }),

  deleteRule: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new LeadScoringService(ctx)
      return service.deleteRule(input.id)
    }),

  compute: protectedProcedure
    .input(z.object({ leadId: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new LeadScoringService(ctx)
      return service.computeScore(input.leadId)
    }),

  getScore: protectedProcedure
    .input(z.object({ leadId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      const service = new LeadScoringService(ctx)
      return service.getScore(input.leadId)
    }),

  batchCompute: protectedProcedure
    .input(z.object({ leadIds: z.array(z.string().uuid()) }))
    .mutation(({ ctx, input }) => {
      const service = new LeadScoringService(ctx)
      return service.batchCompute(input.leadIds)
    }),
})

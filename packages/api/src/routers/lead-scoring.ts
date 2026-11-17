import { isFeatureEnabled } from '@phynd/config/features'
import { LeadScoringService } from '@phynd/services'
import type { ScoringCondition } from '@phynd/types/crm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

function assertLeadScoring() {
  if (!isFeatureEnabled('leadScoring')) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Feature not enabled: leadScoring',
    })
  }
}

const conditionOperator = z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'contains', 'exists', 'in'])

const baseConditionSchema = z.object({
  field: z.string(),
  operator: conditionOperator,
  value: z.unknown().optional(),
})

// `all`: further conditions that must hold too, one level deep.
const scoringConditionSchema = baseConditionSchema.extend({
  all: z.array(baseConditionSchema).max(5).optional(),
})

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()

export const leadScoringRouter = router({
  listRules: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    assertLeadScoring()
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
      assertLeadScoring()
      const service = new LeadScoringService(ctx)
      return service.createRule({
        ...input,
        condition: input.condition as ScoringCondition,
      })
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
      assertLeadScoring()
      const { id, ...data } = input
      const service = new LeadScoringService(ctx)
      return service.updateRule(id, {
        ...data,
        ...(data.condition ? { condition: data.condition as ScoringCondition } : {}),
      })
    }),

  deleteRule: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      assertLeadScoring()
      const service = new LeadScoringService(ctx)
      return service.deleteRule(input.id)
    }),

  compute: protectedProcedure
    .input(z.object({ leadId: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      assertLeadScoring()
      const service = new LeadScoringService(ctx)
      return service.computeScore(input.leadId)
    }),

  getScore: protectedProcedure
    .input(z.object({ leadId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      assertLeadScoring()
      const service = new LeadScoringService(ctx)
      return service.getScore(input.leadId)
    }),

  batchCompute: protectedProcedure
    .input(z.object({ leadIds: z.array(z.string().uuid()) }))
    .mutation(({ ctx, input }) => {
      assertLeadScoring()
      const service = new LeadScoringService(ctx)
      return service.batchCompute(input.leadIds)
    }),
})

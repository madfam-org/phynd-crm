import { isFeatureEnabled } from '@phynd/config/features'
import { CampaignAuthorizationService } from '@phynd/services'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

function assertFunnelManagement() {
  if (!isFeatureEnabled('funnelManagement')) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Feature not enabled: funnelManagement',
    })
  }
}

function isServiceActor(userId: string, roles: string[]): boolean {
  return roles.includes('service') || userId.startsWith('service:')
}

/**
 * Resolve who the decision is attributed to and which surface carried it.
 * Staff sessions decide as themselves (via web). Service principals (Selva)
 * relay the owner's decision and MUST assert the operator identity — the
 * audit row then records both (`operator (via service:selva)`).
 */
function resolveDecisionActor(
  auth: { userId: string; roles: string[] },
  actor: string | undefined,
): { decidedBy: string; decidedVia: string } {
  if (!isServiceActor(auth.userId, auth.roles)) {
    return { decidedBy: auth.userId, decidedVia: 'web' }
  }
  const operator = actor?.trim()
  if (!operator) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Service principals must pass `actor` — the human operator making this decision',
    })
  }
  return { decidedBy: `${operator} (via ${auth.userId})`, decidedVia: 'selva' }
}

export const campaignAuthorizationsRouter = router({
  listPending: protectedProcedure.query(({ ctx }) => {
    assertFunnelManagement()
    return new CampaignAuthorizationService(ctx).listPending()
  }),

  listRecentDecided: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ ctx, input }) => {
      assertFunnelManagement()
      return new CampaignAuthorizationService(ctx).listRecentDecided(input?.limit ?? 20)
    }),

  // Full review payload: frozen snapshot + rendered email HTML per variant
  // (production pipeline) + staleness check against the live campaign.
  getPreview: protectedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    assertFunnelManagement()
    return new CampaignAuthorizationService(ctx).preview(input.id)
  }),

  // (Re-)create a pending authorization request for a campaign — used when a
  // prior request went stale or an import predates the authorization gate.
  request: protectedProcedure
    .input(z.object({ campaignId: z.string() }))
    .mutation(({ ctx, input }) => {
      assertFunnelManagement()
      return new CampaignAuthorizationService(ctx).request(input.campaignId, ctx.auth.userId)
    }),

  decide: protectedProcedure
    .input(
      z
        .object({
          id: z.string(),
          decision: z.enum(['authorized', 'rejected']),
          note: z.string().max(2000).optional(),
          // Human operator identity — required when the caller is a service
          // principal relaying the decision (e.g. Selva).
          actor: z.string().max(255).optional(),
        })
        .superRefine((value, ctx) => {
          if (value.decision === 'rejected' && !value.note?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['note'],
              message: 'A note explaining the rejection is required',
            })
          }
        }),
    )
    .mutation(({ ctx, input }) => {
      assertFunnelManagement()
      const { decidedBy, decidedVia } = resolveDecisionActor(ctx.auth, input.actor)
      return new CampaignAuthorizationService(ctx).decide(input.id, input.decision, {
        decidedBy,
        decidedVia,
        note: input.note,
      })
    }),
})

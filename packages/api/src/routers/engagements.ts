import {
  ClientProjectOnboardingService,
  EngagementPortalMagicLinkService,
  EngagementRecoveryService,
  EngagementsService,
  PublishQuoteToPortalService,
} from '@phynd/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const clientProjectKind = z.enum(['digital', 'physical', 'phygital'])
const deliveryTrack = z.enum([
  'digital_experience',
  'digital_twin',
  'fabrication',
  'fulfillment',
  'kiosk',
])

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

  onboardClientProject: protectedProcedure
    .input(
      z.object({
        client: z.object({
          name: z.string().min(1).max(255),
          email: z.string().email().optional(),
          phone: z.string().max(50).optional(),
          company: z.string().max(255).optional(),
          externalJanuaId: z.string().max(255).optional(),
        }),
        project: z.object({
          name: z.string().min(1).max(255),
          description: z.string().max(2000).optional(),
          kind: clientProjectKind,
          deliveryTracks: z.array(deliveryTrack).optional(),
        }),
        commercial: z.object({
          pipelineId: z.string().min(1),
          stageId: z.string().min(1),
          amount: z.string().optional(),
          currency: z.string().max(10).optional(),
          expectedCloseDate: z.date().optional(),
          quoteNumber: z.string().min(1).max(50).optional(),
          quoteStatus: z.enum(['draft', 'sent']).optional(),
          quoteValidUntil: z.date().optional(),
          createProductionOrder: z.boolean().optional(),
          orderNumber: z.string().min(1).max(50).optional(),
          orderStatus: z.enum(['pending', 'confirmed', 'in_production']).optional(),
          estimatedCompletion: z.date().optional(),
        }),
        intakeSource: z.enum(['api', 'crm', 'selva_office']).optional(),
        ownerId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new ClientProjectOnboardingService(ctx)
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

  // Staff-initiated. Fires Janua's magic-link email to the engagement's
  // contact with a redirect_url pointing back at PhyndCRM's /portal/verify.
  // Rate-limiting is handled by Janua (5/hour per email).
  sendPortalLink: protectedProcedure
    .input(z.object({ engagementId: z.string() }))
    .mutation(({ ctx, input }) => {
      const service = new EngagementPortalMagicLinkService(ctx)
      return service.sendPortalLink(input.engagementId)
    }),

  publishQuoteToPortal: protectedProcedure
    .input(
      z.object({
        engagementId: z.string(),
        quoteId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new PublishQuoteToPortalService(ctx)
      return service.publish(input)
    }),

  publishQuoteAndSendPortalLink: protectedProcedure
    .input(
      z.object({
        engagementId: z.string(),
        quoteId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new PublishQuoteToPortalService(ctx)
      return service.publishAndSendPortalLink(input)
    }),

  listBlockedEvents: protectedProcedure
    .input(z.object({ engagementId: z.string() }))
    .query(({ ctx, input }) => {
      const service = new EngagementRecoveryService(ctx)
      return service.listBlockedEvents(input.engagementId)
    }),

  linkPaymentToOrder: protectedProcedure
    .input(
      z.object({
        blockedEventId: z.string(),
        orderId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new EngagementRecoveryService(ctx)
      return service.linkPaymentToOrder(input)
    }),

  retryProductionDispatch: protectedProcedure
    .input(
      z.object({
        blockedEventId: z.string(),
        deliveryTracks: z.array(deliveryTrack).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new EngagementRecoveryService(ctx)
      return service.retryProductionDispatch(input)
    }),

  resolveBlockedEvent: protectedProcedure
    .input(
      z.object({
        blockedEventId: z.string(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new EngagementRecoveryService(ctx)
      return service.resolveBlockedEvent(input)
    }),
})

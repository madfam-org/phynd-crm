import {
  CONSENT_ACTIONS,
  CONSENT_CHANNELS,
  ConsentService,
  SUPPRESSION_CHANNELS,
  SUPPRESSION_REASONS,
  SuppressionService,
} from '@phynd/services'
import { z } from 'zod'
import { protectedProcedure, requireRole, router } from '../trpc'

const adminProcedure = protectedProcedure.use(requireRole('admin'))

const consentChannelSchema = z.enum(CONSENT_CHANNELS)
const suppressionChannelSchema = z.enum(SUPPRESSION_CHANNELS)

// Staff/service surface for the LFPDPPP consent + suppression models.
// External product repos (dhanam/karafiel/tezca) use the HMAC-signed REST
// endpoints under /api/v1/consent instead — see docs/CONSENT_API.md.
export const consentRouter = router({
  getForIdentifier: protectedProcedure
    .input(z.object({ identifier: z.string().min(1).max(255), channel: consentChannelSchema }))
    .query(({ ctx, input }) => {
      const service = new ConsentService(ctx)
      return service.getConsent(input.identifier, input.channel)
    }),

  listForContact: protectedProcedure
    .input(z.object({ contactId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      const service = new ConsentService(ctx)
      return service.listForContact(input.contactId)
    }),

  checkPermission: protectedProcedure
    .input(z.object({ identifier: z.string().min(1).max(255), channel: consentChannelSchema }))
    .query(({ ctx, input }) => {
      const service = new ConsentService(ctx)
      return service.checkPermission(input.identifier, input.channel)
    }),

  capture: protectedProcedure
    .input(
      z.object({
        identifier: z.string().min(1).max(255),
        channel: consentChannelSchema,
        action: z.enum(CONSENT_ACTIONS),
        source: z.string().min(1).max(128),
        evidence: z.string().max(4000).optional(),
        contactId: z.string().uuid().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const service = new ConsentService(ctx)
      const result = await service.capture(input)
      // Never return the raw double-opt-in token to the dashboard — it is
      // the confirmation credential and only travels via the confirm email.
      return {
        record: result.record,
        doubleOptInPending: Boolean(result.doubleOptIn),
        doubleOptInExpiresAt: result.doubleOptIn?.expiresAt ?? null,
      }
    }),

  suppressionAdd: protectedProcedure
    .input(
      z.object({
        identifier: z.string().min(1).max(255),
        channel: suppressionChannelSchema.optional(),
        reason: z.enum(SUPPRESSION_REASONS),
        source: z.string().min(1).max(128),
        evidence: z.string().max(4000).optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new SuppressionService(ctx)
      return service.add(input)
    }),

  suppressionCheck: protectedProcedure
    .input(
      z.object({
        identifier: z.string().min(1).max(255),
        channel: suppressionChannelSchema.default('all'),
      }),
    )
    .query(({ ctx, input }) => {
      const service = new SuppressionService(ctx)
      return service.check(input.identifier, input.channel)
    }),

  suppressionList: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          filters: z
            .object({
              channel: suppressionChannelSchema.optional(),
              reason: z.enum(SUPPRESSION_REASONS).optional(),
              identifier: z.string().max(255).optional(),
            })
            .optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const service = new SuppressionService(ctx)
      const { filters, ...pagination } = input ?? {}
      return service.list(pagination, filters)
    }),

  suppressionRemove: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new SuppressionService(ctx)
      return service.remove(input.id)
    }),
})

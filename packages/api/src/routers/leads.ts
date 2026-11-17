import { LEAD_ASSIGNABLE_ROLES, LeadsService, requireCrmUserId } from '@phynd/services'
import {
  LEAD_ATTRIBUTION_MAX_LENGTH,
  LEAD_ATTRIBUTION_URL_MAX_LENGTH,
} from '@phynd/services/leads/lead-attribution'
import { z } from 'zod'
import { protectedProcedure, requireRole, router } from '../trpc'
import { entityId } from '../validation'

const attributionValue = z.string().trim().min(1).max(LEAD_ATTRIBUTION_MAX_LENGTH)
const attributionUrl = z.string().trim().min(1).max(LEAD_ATTRIBUTION_URL_MAX_LENGTH)

// Same shape `sanitizeLeadAttribution` keeps; unknown keys are stripped.
const leadAttributionInput = z.object({
  utm_source: attributionValue.optional(),
  utm_medium: attributionValue.optional(),
  utm_campaign: attributionValue.optional(),
  utm_content: attributionValue.optional(),
  utm_term: attributionValue.optional(),
  referrer: attributionUrl.optional(),
  landing_page: attributionUrl.optional(),
  tenant: attributionValue.optional(),
  quote_id: attributionValue.optional(),
  quote_number: attributionValue.optional(),
  quote_total: attributionValue.optional(),
  quote_currency: attributionValue.optional(),
  lead_type: attributionValue.optional(),
  ec_code: attributionValue.optional(),
  intent: attributionValue.optional(),
  availability_status: attributionValue.optional(),
  interests: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  booking: z
    .object({
      id: attributionValue.optional(),
      starts_at: attributionValue.optional(),
      event_type_name: attributionValue.optional(),
      host_name: attributionValue.optional(),
      timezone: attributionValue.optional(),
    })
    .optional(),
})

/**
 * Whose leads: `me` (the signed-in CRM user), `unassigned`, or a CRM user id.
 * The `/leads?owner=` link passes it through as is.
 */
export const leadOwnerFilter = z.union([z.enum(['me', 'unassigned']), z.string().uuid()])

const paginationInput = z
  .object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    ownerId: z.string().uuid().optional(),
    owner: leadOwnerFilter.optional(),
    tier: z.enum(['A', 'B', 'C']).optional(),
  })
  .optional()

/** Staff who work leads may assign them; a viewer may not. */
const assignProcedure = protectedProcedure.use(requireRole(...LEAD_ASSIGNABLE_ROLES))

export const leadsRouter = router({
  list: protectedProcedure.input(paginationInput).query(({ ctx, input }) => {
    const { ownerId, owner, tier, ...pagination } = input ?? {}
    const service = new LeadsService(ctx)
    const ownerFilter =
      owner === 'me'
        ? { ownerId: requireCrmUserId(ctx.auth) }
        : owner === 'unassigned'
          ? { unassigned: true }
          : owner || ownerId
            ? { ownerId: owner ?? ownerId }
            : {}
    return service.list(pagination, { ...ownerFilter, ...(tier ? { tier } : {}) })
  }),

  /** CRM users a lead can be assigned to (for the "Assign to…" menus). */
  assignees: protectedProcedure.query(({ ctx }) => {
    const service = new LeadsService(ctx)
    return service.listAssignees()
  }),

  /**
   * Reassigns a lead: owner, its open "First contact" task, a timeline entry,
   * and an in-app notification to the new owner.
   */
  assign: assignProcedure
    .input(z.object({ id: z.string().uuid(), ownerId: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.assign(input.id, input.ownerId)
    }),

  listMine: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.list(input ?? undefined, { ownerId: requireCrmUserId(ctx.auth) })
    }),

  listByContactId: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const { contactId, ...pagination } = input
      const service = new LeadsService(ctx)
      return service.listByContactId(contactId, pagination)
    }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
    const service = new LeadsService(ctx)
    return service.getById(input.id)
  }),

  create: protectedProcedure
    .input(
      z.object({
        contactId: z.string().uuid().optional(),
        externalJanuaId: z.string().optional(),
        source: z.string().max(100).optional(),
        attribution: leadAttributionInput.nullable().optional(),
        pipelineId: entityId,
        stageId: entityId,
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.create(input)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']).optional(),
        score: z.number().int().min(0).max(100).optional(),
        stageId: entityId.optional(),
        ownerId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ownerId, ...data } = input
      const service = new LeadsService(ctx)
      // An owner change goes through the same path as "Assign to…", so the
      // first-contact task and the timeline follow it.
      if (ownerId) {
        const current = await service.getById(id)
        if (current && current.ownerId !== ownerId) {
          const assigned = await service.assign(id, ownerId)
          if (Object.keys(data).length === 0) return assigned
        }
      }
      if (Object.keys(data).length === 0) return service.getById(id)
      return service.update(id, data)
    }),

  moveToStage: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        stageId: entityId,
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.moveToStage(input.id, input.stageId)
    }),

  bulkUpdateStatus: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()).min(1).max(100),
        status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted']),
      }),
    )
    .mutation(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.bulkUpdateStatus(input.ids, input.status)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      const service = new LeadsService(ctx)
      return service.delete(input.id)
    }),
})

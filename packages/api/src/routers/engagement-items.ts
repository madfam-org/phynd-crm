import type { EngagementItemKind, EngagementItemSide, EngagementItemStatus } from '@phynd/db/schema'
import { EngagementContactsService, EngagementItemsService } from '@phynd/services'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const id = z.string().min(1).max(64)

// Mirrors the CHECK constraints of engagement_items (packages/db/src/schema/
// engagement-items.ts). Type-only imports keep router tests free to mock the
// schema module.
const KINDS = [
  'milestone',
  'deliverable',
  'actionable',
  'decision',
] as const satisfies readonly EngagementItemKind[]
const STATUSES = [
  'planned',
  'in_progress',
  'done',
  'blocked',
  'awaiting_client',
] as const satisfies readonly EngagementItemStatus[]
const SIDES = ['madfam', 'client'] as const satisfies readonly EngagementItemSide[]
export const ENGAGEMENT_ITEM_INPUT_ENUMS = { kinds: KINDS, statuses: STATUSES, sides: SIDES }

const itemFields = {
  kind: z.enum(KINDS),
  title: z.string().trim().min(1).max(255),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  side: z.enum(SIDES).optional(),
  ownerUserId: id.nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
  // Default false: nothing reaches the client portal unless staff opt in.
  clientVisible: z.boolean().optional(),
  artifactId: id.nullable().optional(),
  externalKey: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._/-]{0,199}$/)
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
}

// Staff CRUD for milestones, deliverables, actionables and decisions. The
// service token's engagements:read scope does not reach these procedures.
export const engagementItemsRouter = router({
  list: protectedProcedure.input(z.object({ engagementId: id })).query(({ ctx, input }) => {
    return new EngagementItemsService(ctx).list(input.engagementId)
  }),

  create: protectedProcedure
    .input(z.object({ engagementId: id, ...itemFields }))
    .mutation(({ ctx, input }) => {
      const { engagementId, ...data } = input
      return new EngagementItemsService(ctx).create(engagementId, data)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id,
        ...itemFields,
        kind: itemFields.kind.optional(),
        title: itemFields.title.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id: itemId, ...patch } = input
      return new EngagementItemsService(ctx).update(itemId, patch)
    }),

  reorder: protectedProcedure
    .input(z.object({ engagementId: id, orderedIds: z.array(id).min(1).max(500) }))
    .mutation(({ ctx, input }) => {
      return new EngagementItemsService(ctx).reorder(input.engagementId, input.orderedIds)
    }),

  delete: protectedProcedure.input(z.object({ id })).mutation(({ ctx, input }) => {
    return new EngagementItemsService(ctx).delete(input.id)
  }),
})

// Extra contacts of an engagement; portalAccess lets them open the client portal.
export const engagementContactsRouter = router({
  list: protectedProcedure.input(z.object({ engagementId: id })).query(({ ctx, input }) => {
    return new EngagementContactsService(ctx).list(input.engagementId)
  }),

  upsert: protectedProcedure
    .input(
      z.object({
        engagementId: id,
        contactId: id,
        role: z.string().trim().min(1).max(50).nullable().optional(),
        portalAccess: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return new EngagementContactsService(ctx).upsert(input)
    }),

  remove: protectedProcedure
    .input(z.object({ engagementId: id, contactId: id }))
    .mutation(({ ctx, input }) => {
      return new EngagementContactsService(ctx).remove(input.engagementId, input.contactId)
    }),
})

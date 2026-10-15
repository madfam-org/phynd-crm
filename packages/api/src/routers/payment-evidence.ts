import type { PaymentEvidenceSource, PaymentMethod } from '@phynd/db/schema'
import { PaymentEvidenceService, canViewEvidence, describeBalance } from '@phynd/services'
import {
  EVIDENCE_URL_TTL_SECONDS,
  evidenceStorageFromEnv,
} from '@phynd/services/payment-evidence/storage'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

// Mirrors the CHECK constraints of payment_evidence (packages/db/src/schema/
// payment-evidence.ts). Type-only schema imports keep router tests free to
// mock the schema module.
const METHODS = [
  'spei_transfer',
  'card',
  'cash',
  'other',
] as const satisfies readonly PaymentMethod[]
const SOURCES = ['manual', 'extracted'] as const satisfies readonly PaymentEvidenceSource[]
export const PAYMENT_EVIDENCE_INPUT_ENUMS = { methods: METHODS, sources: SOURCES }

const id = z.string().min(1).max(64)
const text = (max: number) => z.string().trim().max(max).nullable().optional()
const last4 = z
  .string()
  .regex(/^\d{4}$/, 'Only the last 4 digits')
  .nullable()
  .optional()

const fields = {
  quoteId: id.nullable().optional(),
  orderId: id.nullable().optional(),
  contactId: id.nullable().optional(),
  method: z.enum(METHODS),
  bankName: text(100),
  operationType: text(100),
  folio: text(64),
  trackingKey: text(64),
  paidAt: z.coerce.date(),
  amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Positive amount, 2 decimals max'),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
  reference: text(255),
  originAccountLast4: last4,
  destinationAccountLast4: last4,
  beneficiaryName: text(255),
  notes: text(4000),
  source: z.enum(SOURCES).optional(),
  extractionConfidence: z.number().min(0).max(1).nullable().optional(),
  evidenceStorageKey: z.string().max(255).nullable().optional(),
  evidenceMime: z.string().max(50).nullable().optional(),
  evidenceSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
  clientVisible: z.boolean().optional(),
  externalKey: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._/-]{0,199}$/)
    .nullable()
    .optional(),
}

// Staff only: service tokens have no paymentEvidence scope. Account numbers are
// refused by the service (last 4 digits at most anywhere in the record).
export const paymentEvidenceRouter = router({
  list: protectedProcedure.input(z.object({ engagementId: id })).query(({ ctx, input }) => {
    return new PaymentEvidenceService(ctx).list(input.engagementId)
  }),

  get: protectedProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const service = new PaymentEvidenceService(ctx)
    const [evidence, reconciliation] = await Promise.all([
      service.getById(input.id),
      service.reconciliationFor(input.id),
    ])
    return { evidence, reconciliation, balanceText: describeBalance(reconciliation) }
  }),

  create: protectedProcedure
    .input(z.object({ engagementId: id, ...fields }))
    .mutation(({ ctx, input }) => {
      const { engagementId, ...data } = input
      return new PaymentEvidenceService(ctx).create(engagementId, data)
    }),

  update: protectedProcedure
    .input(
      z.object({
        id,
        ...fields,
        method: fields.method.optional(),
        paidAt: fields.paidAt.optional(),
        amount: fields.amount.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id: evidenceId, ...patch } = input
      return new PaymentEvidenceService(ctx).update(evidenceId, patch)
    }),

  verify: protectedProcedure.input(z.object({ id })).mutation(({ ctx, input }) => {
    return new PaymentEvidenceService(ctx).verify(input.id)
  }),

  void: protectedProcedure
    .input(z.object({ id, reason: z.string().trim().min(1).max(500) }))
    .mutation(({ ctx, input }) => {
      return new PaymentEvidenceService(ctx).void(input.id, input.reason)
    }),

  /** A short-lived signed URL for the evidence file (staff may open any receipt). */
  evidenceUrl: protectedProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const evidence = await new PaymentEvidenceService(ctx).getById(input.id)
    if (!canViewEvidence({ kind: 'staff' }, evidence) || !evidence.evidenceStorageKey) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'This payment has no evidence file' })
    }
    const storage = evidenceStorageFromEnv()
    if (!storage) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Evidence storage is not configured',
      })
    }
    return {
      url: storage.presignGet(evidence.evidenceStorageKey, {
        expiresIn: EVIDENCE_URL_TTL_SECONDS,
        contentType: evidence.evidenceMime ?? undefined,
        inlineFilename: `comprobante-${evidence.id.slice(0, 8)}`,
      }),
      mime: evidence.evidenceMime,
      expiresIn: EVIDENCE_URL_TTL_SECONDS,
    }
  }),
})

import { z } from 'zod'

const proofPointSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  source_url: z.string().url().optional(),
})

const guardrailsSchema = z.object({
  do_not_claim: z.array(z.string()).default([]),
  policy_state: z.string().optional(),
  last_verified_at: z.string().optional(),
})

const commercialGaEvidenceSchema = z.object({
  gate_id: z.enum(['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9']),
  status: z.enum(['not_started', 'pending', 'passed', 'failed', 'waived']),
  evidence_url: z.string().min(1).optional(),
  source_system: z.string().min(1).optional(),
  source_record_id: z.string().min(1).optional(),
})

const moneyPathSchema = z.object({
  checkout_required: z.boolean().default(true),
  payment_required: z.boolean().default(true),
  entitlement_required: z.boolean().default(true),
  bbva_payout_required: z.boolean().default(true),
  converge_revenue_required: z.boolean().default(true),
  checkout_url: z.string().url().optional(),
})

const draftSchema = z.object({
  channel: z.string().min(1),
  locale: z.string().optional(),
  body: z.string().min(1),
})

export const tulanaCampaignImportSchema = z.object({
  idempotency_key: z.string().min(1).max(255),
  source: z.string().min(1).max(32).default('tulana'),
  orchestrator: z.string().max(32).optional(),
  sku_key: z.string().min(1).max(128),
  platform: z.string().min(1).max(64),
  audience: z.string().max(255).optional(),
  ga_readiness: z.enum(['not_ready', 'near_ready', 'ready']),
  commercial_ga_status: z.enum(['blocked', 'candidate', 'ga_ready', 'paused']).optional(),
  commercial_ga_gate_version: z.string().max(32).optional(),
  commercial_ga_environment: z.string().max(32).optional(),
  commercial_ga_period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  audience_id: z.string().max(255).optional(),
  consent_basis: z.string().max(255).optional(),
  human_approver_email: z.string().email().optional(),
  gate_evidence: z.array(commercialGaEvidenceSchema).default([]),
  money_path: moneyPathSchema.optional(),
  campaign_type: z.string().optional(),
  value_prop: z.string().min(1),
  proof_points: z.array(proofPointSchema).default([]),
  guardrails: guardrailsSchema.optional(),
  drafts: z.array(draftSchema).default([]),
})

export type TulanaCampaignImportInput = z.infer<typeof tulanaCampaignImportSchema>

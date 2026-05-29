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
  campaign_type: z.string().optional(),
  value_prop: z.string().min(1),
  proof_points: z.array(proofPointSchema).default([]),
  guardrails: guardrailsSchema.optional(),
  drafts: z.array(draftSchema).default([]),
})

export type TulanaCampaignImportInput = z.infer<typeof tulanaCampaignImportSchema>

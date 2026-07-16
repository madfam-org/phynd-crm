/**
 * `madfam.ops.v1` — the cross-service operational-event envelope.
 *
 * Extends the already-deployed `ServiceEventEnvelope` (see ./crm.ts, mirrored
 * from dhanam's event-publisher) with the three fields customer-level routing
 * needs: `schema_version`, `dedup_key`, and `subject`. Ops events flow INTO
 * phynd over the HMAC-signed webhook at `POST /api/v1/ops/events`; the receiver
 * dedups on the envelope `id`, resolves the subject to a CRM contact, writes a
 * timeline activity, and (rule-permitting) persists a pending upsell offer.
 *
 * This file is the source of truth on the phynd side. It is mirrored in
 * dhanam's `apps/api/src/modules/events/ops-event.types.ts` until a shared
 * `@madfam/types` package publishes.
 */

export const OPS_EVENT_SCHEMA_VERSION = 'madfam.ops.v1' as const

export type OpsEventSource = 'dhanam' | 'enclii' | 'pravara' | 'cotiza' | 'tulana' | 'system'

/** The event-type discriminators accepted by the ops-events receiver. */
export const OPS_EVENT_TYPES = [
  'ops.project_milestone_reached',
  'ops.usage_limit_approaching',
  'ops.physical_delivery_confirmed',
] as const

export type OpsEventType = (typeof OPS_EVENT_TYPES)[number]

export interface OpsEventSubject {
  /**
   * At least one identifier is required. `dhanam_customer_id` equals the
   * dhanam `user.id` and the federation `externalId`; `contact_id` is set when
   * the emitter already knows the phynd contact.
   */
  email?: string
  dhanam_customer_id?: string
  janua_sub?: string
  engagement_id?: string
  contact_id?: string
}

export interface OpsEventEnvelope<T extends string = OpsEventType, P = Record<string, unknown>> {
  schema_version: typeof OPS_EVENT_SCHEMA_VERSION
  /** `evt_<uuid>` — emitter-generated; the receiver's idempotency key. */
  id: string
  event_type: T
  source: OpsEventSource
  /** uuid; propagated across every hop of the loop for tracing. */
  correlation_id: string
  /** RFC3339 UTC. */
  timestamp: string
  /** `${source}:${event_type}:${stable_natural_id}` — stable across retries. */
  dedup_key: string
  subject: OpsEventSubject
  payload: P
}

// ---- The 3 named payloads --------------------------------------------------

export interface ProjectMilestonePayload {
  project_id: string
  milestone: 'first_deploy' | 'prod_deploy' | 'go_live' | 'quote_approved' | (string & {})
  service?: string
  environment?: string
  /** RFC3339. */
  occurred_at: string
  metadata?: Record<string, unknown>
}
export type ProjectMilestoneReached = OpsEventEnvelope<
  'ops.project_milestone_reached',
  ProjectMilestonePayload
>

export interface UsageLimitApproachingPayload {
  meter: 'waybill_budget' | 'dhanam_credits' | (string & {})
  project_id?: string
  org_id?: string
  budget_id?: string
  period: string
  period_start: string
  period_end: string
  /** Percent of the limit crossed: 80 | 90 | 100. */
  threshold_crossed: number
  actual_cents?: number
  budget_cents?: number
  credits_used?: number
  credits_included?: number
  currency?: string
  /** Current subscription tier, e.g. 'community' | 'pro' — from user.subscriptionTier. */
  current_plan: string
  /** Next tier for upsell targeting. */
  suggested_plan?: string
}
export type UsageLimitApproaching = OpsEventEnvelope<
  'ops.usage_limit_approaching',
  UsageLimitApproachingPayload
>

export interface PhysicalDeliveryPayload {
  order_id: string
  /** Cotiza quote id — joins to phynd quotes via external_references provider 'cotiza'. */
  quote_id?: string
  /** pravara-mes work order id. */
  work_order_id?: string
  carrier?: string
  tracking_ref?: string
  /** RFC3339. */
  delivered_at: string
  items?: Array<{ sku?: string; description: string; qty: number }>
}
export type PhysicalDeliveryConfirmed = OpsEventEnvelope<
  'ops.physical_delivery_confirmed',
  PhysicalDeliveryPayload
>

export type AnyOpsEvent =
  | ProjectMilestoneReached
  | UsageLimitApproaching
  | PhysicalDeliveryConfirmed

/** True when `value` is a recognized `madfam.ops.v1` event type. */
export function isOpsEventType(value: unknown): value is OpsEventType {
  return typeof value === 'string' && (OPS_EVENT_TYPES as readonly string[]).includes(value)
}

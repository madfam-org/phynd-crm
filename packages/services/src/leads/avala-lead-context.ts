import type { LeadAttribution } from '@phynd/types/crm'
import { sanitizeLeadAttribution } from './lead-attribution'

// First-party context an Avala `avala.lead.captured` event carries (G1), kept
// on the CRM lead and contact: the lead kind, EC code, intent, availability,
// interests, certifier and center ids and the form's commercial-contact
// consent on `leads.attribution`; the prospect's message as a contact note.
// Used by the Avala webhook and by the worker's backfill of stored events, so
// both write exactly the same thing.

/** First line of the contact note that holds the prospect's message. */
export const AVALA_MESSAGE_NOTE_LABEL = 'Message from the Avala form'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * The lead's attribution from the event's `payload.lead` and
 * `payload.attribution` blocks, already sanitised (known keys only, bounded).
 */
export function avalaLeadAttribution(payload: unknown): LeadAttribution | null {
  const block = record(payload)
  const lead = record(block.lead)
  const attribution = record(block.attribution)
  const consent = record(block.consent)
  return sanitizeLeadAttribution({
    utm_source: attribution.utmSource,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
    landing_page: attribution.sourcePage,
    lead_type: lead.leadType,
    ec_code: lead.ecCode,
    intent: attribution.intent,
    availability_status: attribution.availabilityStatus,
    interests: lead.interests,
    certifier_id: lead.certifierId,
    center_id: lead.centerId,
    ...avalaConsent(consent),
  })
}

/**
 * The form's answer to «may we contact you commercially?» Avala sends
 * `consent.commercialContact` as a boolean and `consent.capturedAt`; anything
 * else (no block, a non-boolean) records nothing rather than guessing.
 */
function avalaConsent(consent: Record<string, unknown>): {
  consent_commercial_contact?: string
  consent_captured_at?: string
} {
  if (typeof consent.commercialContact !== 'boolean') return {}
  return {
    consent_commercial_contact: consent.commercialContact ? 'granted' : 'not_granted',
    consent_captured_at: text(consent.capturedAt),
  }
}

/** The prospect's message from `payload.lead.message`, or undefined. */
export function avalaLeadMessage(payload: unknown): string | undefined {
  return text(record(record(payload).lead).message)
}

/** The note content for a message: the label, a blank line, the message as sent. */
export function avalaMessageNote(message: string): string {
  return `${AVALA_MESSAGE_NOTE_LABEL}\n\n${message}`
}

/**
 * Fills the keys `incoming` has and `current` lacks; a value already on the
 * lead (a human edit, or an earlier write) is never overwritten.
 */
export function mergeLeadAttribution(
  current: LeadAttribution | null | undefined,
  incoming: LeadAttribution | null,
): LeadAttribution | null {
  if (!incoming) return current ?? null
  const merged: Record<string, unknown> = { ...(current ?? {}) }
  for (const [key, value] of Object.entries(incoming)) {
    if (merged[key] === undefined) merged[key] = value
  }
  return sanitizeLeadAttribution(merged)
}

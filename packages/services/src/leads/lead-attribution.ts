import type { LeadAttribution, LeadBookingAttribution } from '@phynd/types/crm'

/** Longest value kept for a campaign parameter or a booking field. */
export const LEAD_ATTRIBUTION_MAX_LENGTH = 255
/** Longest value kept for a URL (`referrer`, `landing_page`). */
export const LEAD_ATTRIBUTION_URL_MAX_LENGTH = 500

const FIELD_LIMITS = {
  utm_source: LEAD_ATTRIBUTION_MAX_LENGTH,
  utm_medium: LEAD_ATTRIBUTION_MAX_LENGTH,
  utm_campaign: LEAD_ATTRIBUTION_MAX_LENGTH,
  utm_content: LEAD_ATTRIBUTION_MAX_LENGTH,
  utm_term: LEAD_ATTRIBUTION_MAX_LENGTH,
  referrer: LEAD_ATTRIBUTION_URL_MAX_LENGTH,
  landing_page: LEAD_ATTRIBUTION_URL_MAX_LENGTH,
  tenant: LEAD_ATTRIBUTION_MAX_LENGTH,
  quote_id: LEAD_ATTRIBUTION_MAX_LENGTH,
  quote_number: LEAD_ATTRIBUTION_MAX_LENGTH,
  quote_total: LEAD_ATTRIBUTION_MAX_LENGTH,
  quote_currency: LEAD_ATTRIBUTION_MAX_LENGTH,
  lead_type: LEAD_ATTRIBUTION_MAX_LENGTH,
  ec_code: LEAD_ATTRIBUTION_MAX_LENGTH,
  intent: LEAD_ATTRIBUTION_MAX_LENGTH,
  availability_status: LEAD_ATTRIBUTION_MAX_LENGTH,
  certifier_id: LEAD_ATTRIBUTION_MAX_LENGTH,
  center_id: LEAD_ATTRIBUTION_MAX_LENGTH,
  consent_commercial_contact: LEAD_ATTRIBUTION_MAX_LENGTH,
  consent_captured_at: LEAD_ATTRIBUTION_MAX_LENGTH,
} as const satisfies Record<Exclude<keyof LeadAttribution, 'booking' | 'interests'>, number>

/** Most interests kept, and the longest one. */
export const LEAD_ATTRIBUTION_MAX_INTERESTS = 20
export const LEAD_ATTRIBUTION_INTEREST_MAX_LENGTH = 100

const BOOKING_FIELDS = [
  'id',
  'starts_at',
  'event_type_name',
  'host_name',
  'timezone',
] as const satisfies readonly (keyof LeadBookingAttribution)[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.slice(0, maxLength)
}

function sanitizeInterests(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const interests: string[] = []
  for (const item of value) {
    const cleaned = cleanString(item, LEAD_ATTRIBUTION_INTEREST_MAX_LENGTH)
    if (cleaned !== undefined && !interests.includes(cleaned)) interests.push(cleaned)
    if (interests.length >= LEAD_ATTRIBUTION_MAX_INTERESTS) break
  }
  return interests.length > 0 ? interests : undefined
}

function sanitizeBooking(value: unknown): LeadBookingAttribution | undefined {
  if (!isRecord(value)) return undefined
  const booking: LeadBookingAttribution = {}
  for (const field of BOOKING_FIELDS) {
    const cleaned = cleanString(value[field], LEAD_ATTRIBUTION_MAX_LENGTH)
    if (cleaned !== undefined) booking[field] = cleaned
  }
  return Object.keys(booking).length > 0 ? booking : undefined
}

/**
 * The only shape `leads.attribution` ever holds. Keeps the known keys, string
 * values only (`interests`: a list of strings, at most 20, de-duplicated), trimmed and cut to their maximum length; everything else is
 * left out. Returns `null` when nothing remains, so an empty object is never
 * stored.
 */
export function sanitizeLeadAttribution(input: unknown): LeadAttribution | null {
  if (!isRecord(input)) return null

  const attribution: LeadAttribution = {}
  for (const [field, maxLength] of Object.entries(FIELD_LIMITS) as [
    keyof typeof FIELD_LIMITS,
    number,
  ][]) {
    const cleaned = cleanString(input[field], maxLength)
    if (cleaned !== undefined) attribution[field] = cleaned
  }

  const booking = sanitizeBooking(input.booking)
  if (booking) attribution.booking = booking

  const interests = sanitizeInterests(input.interests)
  if (interests) attribution.interests = interests

  return Object.keys(attribution).length > 0 ? attribution : null
}

import { sanitizeLeadAttribution } from '@phynd/services/leads/lead-attribution'
import type { LeadAttribution } from '@phynd/types/crm'

// What an `avala.lead.captured` payload says about the prospect beyond the
// contact fields: their message, how Avala classified them (`leadType`), the
// competency standard and intent behind the form, and the page and campaign
// it came from. The receiver writes it as a note on the lead plus
// `leads.attribution`; the owner-run backfill
// (`scripts/backfill-avala-lead-context.mjs`) writes the same thing for leads
// stored before the receiver kept it. Both must stay in step: a test compares
// their output.

/** Author of the notes the Avala receiver writes (the service principal). */
export const AVALA_SERVICE_ACTOR = 'service:avala'

/** At most this many interests are listed in the note. */
const MAX_INTERESTS = 20

export interface AvalaLeadContext {
  avalaLeadId?: string
  /** The lead source Avala reports (form or CTA), `avala` when absent. */
  source: string
  message?: string
  leadType?: string
  ecCode?: string
  intent?: string
  interests: string[]
  sourcePage?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** The context of an `avala.lead.captured` payload; unknown or malformed fields are left out. */
export function readAvalaLeadContext(payload: Record<string, unknown>): AvalaLeadContext {
  const lead = readObject(payload.lead)
  const attribution = readObject(payload.attribution)
  const interests = Array.isArray(lead.interests)
    ? lead.interests
        .map(readString)
        .filter((value): value is string => value !== undefined)
        .slice(0, MAX_INTERESTS)
    : []
  return {
    avalaLeadId: readString(lead.id),
    source: readString(lead.source) ?? 'avala',
    message: readString(lead.message),
    leadType: readString(lead.leadType),
    ecCode: readString(lead.ecCode),
    intent: readString(attribution.intent),
    interests,
    sourcePage: readString(attribution.sourcePage),
    utmSource: readString(attribution.utmSource),
    utmMedium: readString(attribution.utmMedium),
    utmCampaign: readString(attribution.utmCampaign),
  }
}

/**
 * A waitlist entry: the prospect asked to hear when a standard is available.
 * Avala marks those standards as not for sale yet, so the CRM never treats
 * them as a sales target.
 */
export function isAvalaWaitlistLead(context: AvalaLeadContext): boolean {
  return context.source === 'ec_waitlist' || context.interests.includes('waitlist')
}

/** `leads.attribution` for an Avala lead: page, campaign and lead type. */
export function avalaLeadAttribution(context: AvalaLeadContext): LeadAttribution | null {
  return sanitizeLeadAttribution({
    utm_source: context.utmSource,
    utm_medium: context.utmMedium,
    utm_campaign: context.utmCampaign,
    landing_page: context.sourcePage,
    lead_type: context.leadType,
  })
}

/** Note and task line for a waitlist entry. */
const WAITLIST_LINE =
  'lista de espera: no es un prospecto de venta; avisar cuando el estándar esté disponible.'

/** The prospect's message, then one line per known piece of context. */
export function avalaLeadNote(context: AvalaLeadContext): string {
  const origin = ['— vía formulario de Avala']
  if (context.sourcePage) origin.push(context.sourcePage)
  const lines = [context.message ?? '(sin mensaje)', '', origin.join(' · ')]
  lines.push(`— origen en Avala: ${context.source}`)
  if (context.leadType) lines.push(`— tipo de lead: ${context.leadType}`)
  if (context.ecCode) lines.push(`— estándar: ${context.ecCode}`)
  if (context.intent) lines.push(`— intención: ${context.intent}`)
  if (context.interests.length > 0) lines.push(`— intereses: ${context.interests.join(', ')}`)
  if (isAvalaWaitlistLead(context)) lines.push(`— ${WAITLIST_LINE}`)
  return lines.join('\n')
}

/** Description of the lead's first-contact task. */
export function avalaFirstContactDescription(context: AvalaLeadContext): string {
  const parts = ['Lead por formulario de Avala.']
  if (context.ecCode) parts.push(`Estándar: ${context.ecCode}.`)
  if (isAvalaWaitlistLead(context)) parts.push(`L${WAITLIST_LINE.slice(1)}`)
  else if (context.message) parts.push('Lee su mensaje en las notas del lead antes de contactar.')
  return parts.join(' ')
}

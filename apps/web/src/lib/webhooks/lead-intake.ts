import { createLogger } from '@phynd/logging'
import { EmailService } from '@phynd/services'
import type { LeadAttribution } from '@phynd/types/crm'

// Shared pieces of the lead-intake webhook (`/api/webhooks/lead-intake`): the
// origin vocabulary, the human-readable booking time, the follow-up due date
// and the notification email. Kept out of the route file so they can be tested
// on their own.

const logger = createLogger('web:webhook:lead-intake')

export const LEAD_INTAKE_SOURCES = ['kalya', 'madfam-site', 'cotiza'] as const
export type LeadIntakeSource = (typeof LEAD_INTAKE_SOURCES)[number]

export const BOOKING_EVENT_TYPE = 'kalya.booking.created'
export const SITE_LEAD_EVENT_TYPE = 'site.lead.captured'
export const QUOTE_EVENT_TYPE = 'cotiza.quote.requested'

const LEAD_EVENT_SOURCE: Record<string, LeadIntakeSource> = {
  [BOOKING_EVENT_TYPE]: 'kalya',
  [SITE_LEAD_EVENT_TYPE]: 'madfam-site',
  [QUOTE_EVENT_TYPE]: 'cotiza',
}

/**
 * `webhook_events.provider` for this route's records. Other routes also write
 * `webhook_events` with a sender's own name (the ops-events route takes it
 * from the payload), so the quoting platform's lead events get a provider of
 * their own and the event_id lookup only ever sees this route's rows. Fits
 * the varchar(20) column.
 */
export const LEAD_INTAKE_PROVIDER: Record<LeadIntakeSource, string> = {
  kalya: 'kalya',
  'madfam-site': 'madfam-site',
  cotiza: 'cotiza-lead-intake',
}

/**
 * The source a lead event must come from, or `undefined` for an event type
 * this webhook does not turn into a lead (those are recorded only).
 */
export function leadEventSource(eventType: string): LeadIntakeSource | undefined {
  return Object.hasOwn(LEAD_EVENT_SOURCE, eventType) ? LEAD_EVENT_SOURCE[eventType] : undefined
}

export const LEAD_INTAKE_ORIGIN_LABEL: Record<LeadIntakeSource, string> = {
  kalya: 'reserva en Kalya',
  'madfam-site': 'formulario del sitio',
  cotiza: 'solicitud de cotización',
}

const SUBJECT_PREFIX: Record<LeadIntakeSource, string> = {
  kalya: 'Nueva reserva en Kalya',
  'madfam-site': 'Nuevo lead del sitio',
  cotiza: 'Nueva solicitud de cotización',
}

/** The quote a `cotiza.quote.requested` event carries, validated and bounded. */
export interface LeadQuote {
  id: string
  number?: string
  /** Plain decimal string; absent while the quote has no price. */
  total?: string
  /** ISO 4217-shaped: three letters, upper case. */
  currency?: string
  itemCount?: number
}

const QUOTE_ID_MAX = 100
const QUOTE_NUMBER_MAX = 50
const QUOTE_TOTAL_MAX = 20
const QUOTE_ITEM_COUNT_MAX = 10_000
const DECIMAL = /^\d+(\.\d+)?$/
const CURRENCY = /^[A-Za-z]{3}$/

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed !== '' && Array.from(trimmed).length <= max ? trimmed : undefined
}

/**
 * The `payload.quote` block, or `null` when it has no usable `id` (absent,
 * not a string, empty or over 100 characters). Every other field that does
 * not fit its shape is dropped on its own, so a malformed field never loses
 * the lead.
 */
export function readLeadQuote(value: unknown): LeadQuote | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const block = value as Record<string, unknown>
  const id = boundedString(block.id, QUOTE_ID_MAX)
  if (!id) return null

  const quote: LeadQuote = { id }
  const number = boundedString(block.number, QUOTE_NUMBER_MAX)
  if (number) quote.number = number
  const total = boundedString(block.total, QUOTE_TOTAL_MAX)
  if (total && DECIMAL.test(total)) quote.total = total
  const currency = boundedString(block.currency, 3)
  if (currency && CURRENCY.test(currency)) quote.currency = currency.toUpperCase()
  const itemCount = block.item_count
  if (
    typeof itemCount === 'number' &&
    Number.isInteger(itemCount) &&
    itemCount >= 0 &&
    itemCount <= QUOTE_ITEM_COUNT_MAX
  ) {
    quote.itemCount = itemCount
  }
  return quote
}

/** How staff refer to a quote: its number, else its id. */
export function quoteLabel(quote: LeadQuote): string {
  return quote.number ?? quote.id
}

/** «1500.00 MXN», «1500.00», or «sin precio aún» while there is no total. */
export function quotePrice(quote: LeadQuote): string {
  if (!quote.total) return 'sin precio aún'
  return quote.currency ? `${quote.total} ${quote.currency}` : quote.total
}

/** «3 partidas» / «1 partida», or undefined when the count is unknown. */
export function quoteItems(quote: LeadQuote): string | undefined {
  if (quote.itemCount === undefined) return undefined
  return `${quote.itemCount} ${quote.itemCount === 1 ? 'partida' : 'partidas'}`
}

/** One line for notes and tasks: «cotización Q-1 · 1500.00 MXN · 3 partidas». */
export function quoteSummary(quote: LeadQuote): string {
  return [`cotización ${quoteLabel(quote)}`, quotePrice(quote), quoteItems(quote)]
    .filter((part): part is string => part !== undefined)
    .join(' · ')
}

/** Staff work in Mexico City: the fallback zone for times and the follow-up clock. */
const STAFF_TIME_ZONE = 'America/Mexico_City'
/** 09:00 in Mexico City, which is UTC-6 all year. */
const FOLLOW_UP_HOUR_UTC = 15
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export function isLeadIntakeSource(value: unknown): value is LeadIntakeSource {
  return typeof value === 'string' && (LEAD_INTAKE_SOURCES as readonly string[]).includes(value)
}

/**
 * A booking start as staff read it: local date and time plus the zone name.
 * An unknown zone falls back to Mexico City; a value that is not a date is
 * shown as it was sent.
 */
export function formatBookingStart(
  startsAt: string | undefined,
  timezone: string | undefined,
): string | undefined {
  if (!startsAt) return undefined
  // Date() also accepts loose free text; only an ISO-8601 date-time is a date here.
  const date = ISO_DATE_TIME.test(startsAt) ? new Date(startsAt) : null
  if (!date || Number.isNaN(date.getTime())) return startsAt

  const format = (timeZone: string): string =>
    `${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date)} (${timeZone})`

  if (timezone) {
    try {
      return format(timezone)
    } catch {
      // Not a zone name this runtime knows; use the staff zone instead.
    }
  }
  return format(STAFF_TIME_ZONE)
}

/**
 * 09:00 Mexico City on the next business day (Monday to Friday) after `now`.
 * Public holidays are not considered.
 */
export function nextBusinessDayDueAt(now: Date = new Date()): Date {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: STAFF_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number) as [number, number, number]

  const cursor = new Date(Date.UTC(year, month - 1, day))
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6)

  cursor.setUTCHours(FOLLOW_UP_HOUR_UTC, 0, 0, 0)
  return cursor
}

/**
 * Who is told about a new lead. `LEADS_NOTIFY_EMAIL` (comma-separated); while
 * it is unset or empty, `NAUTA_LEADS_NOTIFY_EMAIL` is used so the address
 * already configured for the nauta webhook keeps working.
 */
export function leadNotificationRecipients(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const parse = (value: string | undefined): string[] =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')

  const recipients = parse(env.LEADS_NOTIFY_EMAIL)
  return recipients.length > 0 ? recipients : parse(env.NAUTA_LEADS_NOTIFY_EMAIL)
}

function escapeHtml(value: string | undefined): string {
  return (value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface NewLeadNotification {
  source: LeadIntakeSource
  contactId: string
  leadId: string | null
  name: string
  email: string
  company?: string
  phone?: string
  message?: string
  planInterest?: string
  page?: string
  attribution: LeadAttribution | null
  /** The requested quote, for a `cotiza.quote.requested` lead. */
  quote?: LeadQuote | null
  /** Set when a follow-up task was opened for the lead. */
  followUpDueAt?: Date | null
}

/** Table rows of the notification: the person always, the rest when known. */
function notificationRows(
  lead: NewLeadNotification,
  bookingStart: string | undefined,
): [string, string | undefined][] {
  const booking = lead.attribution?.booking
  const quote = lead.quote ?? undefined
  const optionalRows: [string, string | undefined][] = [
    ['Cotización', quote && quoteLabel(quote)],
    ['Total', quote && quotePrice(quote)],
    ['Partidas', quote?.itemCount === undefined ? undefined : String(quote.itemCount)],
    ['Plan de interés', lead.planInterest],
    ['Cuenta de origen (tenant)', lead.attribution?.tenant],
    ['Tipo de reunión', booking?.event_type_name],
    ['Inicio', bookingStart],
    ['Anfitrión', booking?.host_name],
    ['Fuente (UTM)', lead.attribution?.utm_source],
    ['Medio (UTM)', lead.attribution?.utm_medium],
    ['Campaña (UTM)', lead.attribution?.utm_campaign],
  ]
  return [
    ['Nombre', lead.name],
    ['Correo', lead.email],
    ['Organización', lead.company],
    ['Teléfono', lead.phone],
    ...optionalRows.filter(([, value]) => value !== undefined),
  ]
}

/** The inbox preview: the prospect's words, else the meeting, the quote or the origin. */
function notificationPreheader(
  lead: NewLeadNotification,
  bookingStart: string | undefined,
): string {
  if (lead.message) return lead.message.slice(0, 120)
  if (bookingStart) return `Reunión: ${bookingStart}`
  if (lead.quote) return `Solicitud de ${quoteSummary(lead.quote)}`
  return `Origen: ${LEAD_INTAKE_ORIGIN_LABEL[lead.source]}`
}

/**
 * One email per captured lead to the humans who follow up. Best effort by
 * design: it runs after the rows are stored, and neither a missing recipient
 * nor a provider error may turn into a failed webhook (the sender would retry
 * a lead that already exists). `EmailService` itself skips with a warning when
 * no API key is configured. Tags carry the lead and contact ids so opens and
 * clicks can be attributed later.
 */
export async function notifyNewLead(lead: NewLeadNotification): Promise<void> {
  const recipients = leadNotificationRecipients()
  if (recipients.length === 0) {
    logger.warn(
      { leadId: lead.leadId, source: lead.source },
      'LEADS_NOTIFY_EMAIL not configured: lead captured with no notification',
    )
    return
  }

  // Always the canonical host, never NEXT_PUBLIC_APP_URL or the request host
  // (same reasoning as the nauta webhook's notification).
  const crmBase = 'https://crm.madfam.io'
  const leadUrl = lead.leadId ? `${crmBase}/leads/${lead.leadId}` : `${crmBase}/leads`

  const origin = LEAD_INTAKE_ORIGIN_LABEL[lead.source]
  const booking = lead.attribution?.booking
  const bookingStart = formatBookingStart(booking?.starts_at, booking?.timezone)

  const rows = notificationRows(lead, bookingStart)

  const followUp = lead.followUpDueAt
    ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: STAFF_TIME_ZONE }).format(
        lead.followUpDueAt,
      )
    : undefined

  const html = [
    '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a232e">',
    `<h2 style="margin:0 0 4px">Nuevo lead — ${escapeHtml(origin)}</h2>`,
    lead.page ? `<p style="margin:0 0 16px;color:#5a6a7a">Vía ${escapeHtml(lead.page)}</p>` : '',
    '<table style="border-collapse:collapse;width:100%;font-size:14px">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5a6a7a;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`,
    ),
    '</table>',
    lead.message
      ? `<blockquote style="margin:16px 0;padding:12px 16px;background:#f2f6fa;border-left:3px solid #2e6db4;white-space:pre-wrap">${escapeHtml(lead.message)}</blockquote>`
      : '',
    `<p style="margin:20px 0"><a href="${leadUrl}" style="background:#2e6db4;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Abrir en el CRM</a></p>`,
    followUp
      ? `<p style="color:#8a97a5;font-size:12px">Tarea de seguimiento en el CRM para el ${escapeHtml(followUp)}.</p>`
      : '',
    '</div>',
  ].join('')

  const subjectPrefix = SUBJECT_PREFIX[lead.source]

  try {
    const emailService = new EmailService()
    const sent = await emailService.send({
      to: recipients.join(','),
      subject: `${subjectPrefix}: ${lead.name}${lead.company ? ` (${lead.company})` : ''}`,
      html,
      preheader: notificationPreheader(lead, bookingStart),
      tags: [
        { name: 'source', value: lead.source },
        ...(lead.leadId ? [{ name: 'lead_id', value: lead.leadId }] : []),
        { name: 'contact_id', value: lead.contactId },
      ],
    })
    logger.info(
      { leadId: lead.leadId, source: lead.source, resendId: sent?.id ?? null },
      'lead notification sent',
    )
  } catch (error) {
    logger.error(
      { err: error, leadId: lead.leadId, source: lead.source },
      'lead notification failed',
    )
  }
}

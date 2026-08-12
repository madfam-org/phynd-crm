import { getCacheManager } from '@/lib/federation/clients'
import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { webhookEvents } from '@phynd/db/schema'
import { validateMadfamSignature } from '@phynd/federation'
import { createLogger } from '@phynd/logging'
import {
  ContactsService,
  EmailService,
  LeadsService,
  NotesService,
  PipelinesService,
  createServiceContext,
} from '@phynd/services'
import type { AuthContext } from '@phynd/types/auth'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

// Nauta → PhyndCRM webhook. First consumer: the fractional-CTO landing's
// contact form, relayed by nauta as `nauta.lead.captured`. PhyndCRM is the
// system of record for the relationship (ADR 0001 on the nauta side), so a
// prospect exists HERE — nauta deliberately has no Contact model to put them
// in.
//
// Shape and doctrine cloned from the avala webhook one directory over:
//   - `x-madfam-signature` (t=<unix>,v1=<hmac>) — the ecosystem scheme this
//     repo's own payment/avala/routecraft routes verify. NOTE: deliberately
//     NOT the legacy `x-webhook-signature` that /api/v1/engagements/events
//     still uses; that mismatch with nauta's client is tracked separately.
//   - Same env, `PHYND_CRM_EVENTS_SECRET` — the pair the working avala flow
//     already exercises in production. One nauta-side property mirrors it.
//   - 503 when the secret is unset (fail closed), 401 on a bad signature,
//     event_id dedup via webhook_events, unknown event types acknowledged and
//     recorded rather than 500ing the sender.
//
// Envelope:
//   {
//     schema_version: '1',
//     event_id: string,            // uuid minted by nauta; the dedup key
//     event_type: 'nauta.lead.captured',
//     source: 'nauta',
//     occurred_at: ISO-8601,
//     payload: {
//       lead: { name, email, company?, phone?, message? },
//       context?: { page?, plan_interest?, locale? }
//     }
//   }

const logger = createLogger('web:webhook:nauta')

type NautaWebhookEnvelope = {
  schema_version?: string
  event_id?: string
  event_type?: string
  source?: string
  occurred_at?: string
  payload?: Record<string, unknown>
}

type PhyndServiceContext = ReturnType<typeof createServiceContext>

const SERVICE_AUTH: AuthContext = {
  userId: 'service:nauta',
  tenantId: DEFAULT_TENANT_ID,
  roles: ['service'],
  scopes: ['*'],
  accessToken: 'internal:nauta-webhook',
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function validateEvent(event: NautaWebhookEnvelope): string | null {
  if (!event.event_id) return 'event_id is required'
  if (!event.event_type) return 'event_type is required'
  if (event.source !== 'nauta') return "source must be 'nauta'"
  return null
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.PHYND_CRM_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } },
    )
  }

  const rawBody = await req.text()
  const sigResult = validateMadfamSignature(rawBody, req.headers.get('x-madfam-signature'), secret)
  if (!sigResult.ok) {
    logger.warn({ reason: sigResult.reason }, 'rejected Nauta webhook')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: NautaWebhookEnvelope
  try {
    event = JSON.parse(rawBody) as NautaWebhookEnvelope
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const shapeError = validateEvent(event)
  if (shapeError) {
    return NextResponse.json({ error: shapeError }, { status: 400 })
  }

  // biome-ignore lint/style/noNonNullAssertion: validateEvent guarantees it
  const eventId = event.event_id!
  if (await hasSeenEvent(eventId)) {
    return NextResponse.json(
      { received: true, deduplicated: true },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  }

  try {
    await processNautaEvent(event)
    await recordWebhookEvent(event)
  } catch (error) {
    logger.error({ err: error, eventId }, 'Nauta webhook processing error')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  return NextResponse.json(
    { received: true },
    { headers: { 'X-RateLimit-Remaining': String(remaining) } },
  )
}

async function hasSeenEvent(eventId: string): Promise<boolean> {
  const db = getDb()
  const prior = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.provider, 'nauta'),
        sql`${webhookEvents.payload} ->> 'event_id' = ${eventId}`,
      ),
    )
    .limit(1)

  return prior.length > 0
}

async function recordWebhookEvent(event: NautaWebhookEnvelope): Promise<void> {
  await getDb()
    .insert(webhookEvents)
    .values({
      provider: 'nauta',
      eventType: event.event_type ?? 'unknown',
      payload: event as unknown as Record<string, unknown>,
      processedAt: new Date(),
    })
}

function createNautaContext(): PhyndServiceContext {
  return createServiceContext(getDb(), getCacheManager(), SERVICE_AUTH)
}

async function processNautaEvent(event: NautaWebhookEnvelope): Promise<void> {
  const ctx = createNautaContext()
  const eventType = event.event_type ?? ''
  const payload = readObject(event.payload)

  switch (eventType) {
    case 'nauta.lead.captured':
      await handleLeadCaptured(ctx, payload)
      break
    default:
      // Recorded by recordWebhookEvent either way; an unknown type from a
      // signed, registered source is data about the sender's roadmap, not an
      // error worth failing their request over.
      logger.info({ eventType }, 'unhandled nauta event type')
  }
}

async function handleLeadCaptured(
  ctx: PhyndServiceContext,
  payload: Record<string, unknown>,
): Promise<void> {
  const lead = readObject(payload.lead)
  const context = readObject(payload.context)
  const email = readString(lead.email)
  // No email, no lead: the form requires it, so an unsigned-field arrival here
  // is a malformed relay rather than a prospect. Dropping it silently mirrors
  // the engagements route's contract for missing required fields.
  if (!email) return

  const contactsService = new ContactsService(ctx)
  const existing = await contactsService.getByEmail(email)
  const contact =
    existing ??
    (await contactsService.create({
      name: readString(lead.name) ?? email.split('@')[0] ?? email,
      email,
      phone: readString(lead.phone),
      company: readString(lead.company),
    }))

  const crmLead = await createDefaultLead(ctx, contact.id, 'nauta')

  // The prospect's own words are the highest-signal artifact of the whole
  // submission; they land as a note on the contact so the first human to open
  // the record reads what the prospect actually asked for.
  const message = readString(lead.message)
  const planInterest = readString(context.plan_interest)
  const page = readString(context.page)
  const noteLines = [
    message ?? '(sin mensaje)',
    '',
    `— vía ${page ?? 'nauta landing'}${planInterest ? ` · interés: ${planInterest}` : ''}`,
  ]
  const notesService = new NotesService(ctx)
  await notesService.create({
    content: noteLines.join('\n'),
    entityType: 'contact',
    entityId: contact.id,
  })

  logger.info(
    { contactId: contact.id, leadId: crmLead?.id ?? null, hasMessage: message !== undefined },
    'nauta lead captured',
  )

  // Best-effort, AFTER the rows are safe. The lead is already delivered; a
  // Resend outage or an unset recipient must never bounce the webhook into
  // nauta's retry path (its dedup would swallow the retry and the lead would
  // exist with no error anywhere). Failure here is a loud log, not a 500.
  await notifyNewNautaLead({
    contactId: contact.id,
    leadId: crmLead?.id ?? null,
    name: readString(lead.name) ?? email,
    email,
    company: readString(lead.company),
    phone: readString(lead.phone),
    message,
    planInterest,
    page,
  })
}

/**
 * One email per captured lead to the humans who follow up. Recipient comes
 * from NAUTA_LEADS_NOTIFY_EMAIL (comma-separated allowed), set next to
 * EMAIL_FROM in the web deployment — configuration, not code, because the
 * person on point changes more often than a release ships.
 *
 * EmailService already fail-opens with a warning when RESEND_API_KEY is
 * absent; this adds the same posture for the recipient. Tags carry the lead
 * and contact ids so Resend's open/click webhooks can be attributed later.
 */
async function notifyNewNautaLead(lead: {
  contactId: string
  leadId: string | null
  name: string
  email: string
  company?: string
  phone?: string
  message?: string
  planInterest?: string
  page?: string
}): Promise<void> {
  const recipients = (process.env.NAUTA_LEADS_NOTIFY_EMAIL ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
  if (recipients.length === 0) {
    logger.warn(
      { leadId: lead.leadId },
      'NAUTA_LEADS_NOTIFY_EMAIL not configured — nauta lead captured with no notification',
    )
    return
  }

  const crmBase = process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm.madfam.io'
  const leadUrl = lead.leadId ? `${crmBase}/leads/${lead.leadId}` : `${crmBase}/leads`
  const esc = (value: string | undefined): string =>
    (value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const html = [
    '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a232e">',
    '<h2 style="margin:0 0 4px">Nuevo lead — Nauta</h2>',
    `<p style="margin:0 0 16px;color:#5a6a7a">Vía el formulario de ${esc(lead.page ?? 'nauta.madfam.io')}</p>`,
    '<table style="border-collapse:collapse;width:100%;font-size:14px">',
    ...[
      ['Nombre', lead.name],
      ['Correo', lead.email],
      ['Organización', lead.company],
      ['Teléfono', lead.phone],
      ['Plan de interés', lead.planInterest],
    ].map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5a6a7a;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0">${esc(value)}</td></tr>`,
    ),
    '</table>',
    lead.message
      ? `<blockquote style="margin:16px 0;padding:12px 16px;background:#f2f6fa;border-left:3px solid #2e6db4;white-space:pre-wrap">${esc(lead.message)}</blockquote>`
      : '',
    `<p style="margin:20px 0"><a href="${leadUrl}" style="background:#2e6db4;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Abrir en el CRM</a></p>`,
    '<p style="color:#8a97a5;font-size:12px">Compromiso de la landing: respuesta en 1 día hábil.</p>',
    '</div>',
  ].join('')

  try {
    const emailService = new EmailService()
    const sent = await emailService.send({
      to: recipients.join(','),
      subject: `Nuevo lead Nauta: ${lead.name}${lead.company ? ` (${lead.company})` : ''}`,
      html,
      preheader: lead.message?.slice(0, 120) ?? `Plan: ${lead.planInterest ?? 'sin definir'}`,
      tags: [
        { name: 'source', value: 'nauta' },
        ...(lead.leadId ? [{ name: 'lead_id', value: lead.leadId }] : []),
        { name: 'contact_id', value: lead.contactId },
      ],
    })
    logger.info({ leadId: lead.leadId, resendId: sent?.id ?? null }, 'nauta lead notification sent')
  } catch (error) {
    logger.error({ err: error, leadId: lead.leadId }, 'nauta lead notification failed')
  }
}

async function createDefaultLead(ctx: PhyndServiceContext, contactId: string, source: string) {
  const leadsService = new LeadsService(ctx)
  const pipelinesService = new PipelinesService(ctx)
  const pipeline = await pipelinesService.getDefault()
  if (!pipeline) return null

  const stages = await pipelinesService.getStages(pipeline.id)
  const firstStage = stages[0]
  if (!firstStage) return null

  return leadsService.create({
    contactId,
    source,
    pipelineId: pipeline.id,
    stageId: firstStage.id,
  })
}

/**
 * POST /api/v1/probe/leads
 *
 * Idempotent synthetic-lead upsert used by madfam-revenue-loop-probe.
 *
 * Contract (from `autoswarm-office/packages/revenue-loop-probe/.../steps/crm.py`):
 *   - Bearer auth with `PHYND_CRM_PROBE_TOKEN`.
 *   - Body: `{ correlation_id, dry_run, channel, lead: { email, stage, score, source_agent } }`.
 *   - Idempotent on (tenant, correlation_id) OR (tenant, lead.email).
 *   - Returns `{ lead_id }`.
 *
 * Design note — we don't add a schema column for `probe_correlation_id`.
 * Instead, probe leads are identified by a well-known synthetic email
 * (`probe@madfam.io`) and tagged with `source = "synthetic-probe"`. A
 * single row per tenant serves every probe run — the probe doesn't need
 * a new lead per run, just one to drive subsequent stages.
 */

import { getDb } from '@phynd/db'
import { contacts, leads, pipelineStages, pipelines } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('api:v1:probe:leads')

const PROBE_EMAIL = 'probe@madfam.io'
const PROBE_SOURCE = 'synthetic-probe'
const PROBE_EXTERNAL_ID = 'probe-madfam-internal'

function unauthorized(reason: string) {
  logger.warn({ reason }, 'probe.leads unauthorized')
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

function insertFailed(resource: string) {
  logger.error({ resource }, 'probe.leads insert returned no row')
  return NextResponse.json({ error: `failed to create ${resource}` }, { status: 500 })
}

function probeAuthResponse(request: Request) {
  const expectedToken = process.env.PHYND_CRM_PROBE_TOKEN
  if (!expectedToken) {
    return NextResponse.json({ error: 'PHYND_CRM_PROBE_TOKEN not configured' }, { status: 503 })
  }

  const auth = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(auth)
  if (!match || match[1] !== expectedToken) {
    return unauthorized('missing_or_bad_bearer')
  }

  return null
}

function probeCorrelationId(body: Record<string, unknown>, request: Request) {
  return (body.correlation_id as string) || request.headers.get('x-probe-correlation-id') || ''
}

export async function POST(request: Request) {
  const authResponse = probeAuthResponse(request)
  if (authResponse) {
    return authResponse
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const correlationId = probeCorrelationId(body, request)
  if (!correlationId) {
    return NextResponse.json({ error: 'correlation_id required' }, { status: 400 })
  }

  const db = getDb()

  // Find the synthetic probe contact.
  const existingContact = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.externalJanuaId, PROBE_EXTERNAL_ID))
    .limit(1)

  let contactId: string
  const existingContactRow = existingContact[0]
  if (existingContactRow) {
    contactId = existingContactRow.id
  } else {
    const inserted = await db
      .insert(contacts)
      .values({
        externalJanuaId: PROBE_EXTERNAL_ID,
        name: 'MADFAM Revenue Loop Probe',
        email: PROBE_EMAIL,
        status: 'active',
        marketingConsent: false,
      })
      .returning({ id: contacts.id })
    const insertedContact = inserted[0]
    if (!insertedContact) {
      return insertFailed('probe contact')
    }
    contactId = insertedContact.id
  }

  // Find any existing probe lead attached to that contact.
  const existingLead = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.contactId, contactId), eq(leads.source, PROBE_SOURCE)))
    .limit(1)

  const existingLeadRow = existingLead[0]
  if (existingLeadRow) {
    logger.info(
      { lead_id: existingLeadRow.id, correlation_id: correlationId },
      'probe.leads reused existing',
    )
    return NextResponse.json({ lead_id: existingLeadRow.id, reused: true })
  }

  // No probe lead yet — we need a pipeline + stage to insert against.
  const defaultPipeline = await db.select({ id: pipelines.id }).from(pipelines).limit(1)
  const pipeline = defaultPipeline[0]
  if (!pipeline) {
    return NextResponse.json(
      {
        error: 'no pipeline configured — cannot create probe lead',
        remediation: 'seed at least one pipeline row before enabling the probe',
      },
      { status: 503 },
    )
  }
  const pipelineId = pipeline.id

  const firstStage = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipelineId))
    .limit(1)
  const stage = firstStage[0]
  if (!stage) {
    return NextResponse.json(
      {
        error: 'no pipeline stages configured — cannot create probe lead',
        remediation: 'seed at least one pipeline stage before enabling the probe',
      },
      { status: 503 },
    )
  }
  const stageId = stage.id

  const inserted = await db
    .insert(leads)
    .values({
      contactId,
      source: PROBE_SOURCE,
      status: 'new',
      score: Math.round(
        Number((body.lead as Record<string, unknown> | undefined)?.score ?? 0.95) * 100,
      ),
      pipelineId,
      stageId,
    })
    .returning({ id: leads.id })
  const insertedLead = inserted[0]

  if (!insertedLead) {
    return insertFailed('probe lead')
  }

  logger.info({ lead_id: insertedLead.id, correlation_id: correlationId }, 'probe.leads created')
  return NextResponse.json({ lead_id: insertedLead.id, created: true }, { status: 201 })
}

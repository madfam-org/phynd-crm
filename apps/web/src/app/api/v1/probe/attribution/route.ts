/**
 * GET /api/v1/probe/attribution?lead_id=<id>&billing_id=<id>
 *
 * Final stage of the MADFAM revenue-loop probe. Confirms that the
 * payment event → conversion binding we wrote in the
 * `/v1/events/payment.succeeded` receiver is visible.
 *
 * Contract (from `revenue_loop_probe/steps/phynd_attribution.py`):
 *   - Bearer auth with `PHYND_CRM_PROBE_TOKEN`.
 *   - On success: `{ credited: true, source_agent, credit_amount_mxn_cents, attribution_id }`.
 *   - If no matching conversion: `{ credited: false, reason }` (200 OK;
 *     the probe polls until `credited: true` or its timeout fires).
 */

import { getDb } from '@phynd/db'
import { conversions } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { and, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('api:v1:probe:attribution')

function unauthorized(reason: string) {
  logger.warn({ reason }, 'probe.attribution unauthorized')
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function GET(request: Request) {
  const expectedToken = process.env.PHYND_CRM_PROBE_TOKEN
  if (!expectedToken) {
    return NextResponse.json({ error: 'PHYND_CRM_PROBE_TOKEN not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(auth)
  if (!match || match[1] !== expectedToken) {
    return unauthorized('missing_or_bad_bearer')
  }

  const url = new URL(request.url)
  const leadId = url.searchParams.get('lead_id')
  const billingId = url.searchParams.get('billing_id')
  if (!leadId || !billingId) {
    return NextResponse.json(
      { error: 'lead_id and billing_id query params required' },
      { status: 400 },
    )
  }

  const db = getDb()

  // We stored the Dhanam billing_event_id OR the raw ecosystem event_id
  // in metadata. Match either — the probe may pass whichever is more
  // convenient for its stage order.
  const row = await db
    .select({
      id: conversions.id,
      value: conversions.value,
      metadata: conversions.metadata,
      recordedAt: conversions.convertedAt,
    })
    .from(conversions)
    .where(
      and(
        eq(conversions.leadId, leadId),
        sql`(${conversions.metadata}->>'event_id' = ${billingId}
             OR ${conversions.metadata}->>'webhook_event_id' = ${billingId}
             OR ${conversions.metadata}->>'billing_id' = ${billingId})`,
      ),
    )
    .orderBy(sql`${conversions.convertedAt} DESC`)
    .limit(1)

  if (row.length === 0) {
    return NextResponse.json({
      credited: false,
      reason: 'no matching conversion — event not yet processed or attribution not bound',
      lead_id: leadId,
      billing_id: billingId,
    })
  }

  const r = row[0]
  if (!r) {
    return NextResponse.json({
      credited: false,
      reason: 'no matching conversion — event not yet processed or attribution not bound',
      lead_id: leadId,
      billing_id: billingId,
    })
  }

  const meta = (r.metadata ?? {}) as Record<string, unknown>
  const amountMinor =
    typeof meta.amount_minor === 'number'
      ? meta.amount_minor
      : Math.round(Number(r.value ?? 0) * 100)

  return NextResponse.json({
    credited: true,
    attribution_id: r.id,
    lead_id: leadId,
    billing_id: billingId,
    source_agent: meta.source_agent_id ?? null,
    campaign_id: meta.campaign_id ?? null,
    credit_amount_mxn_cents: amountMinor,
    recorded_at: r.recordedAt,
  })
}

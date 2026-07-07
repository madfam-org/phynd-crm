import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { parseSignedWebhookRequest } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  SUPPRESSION_CHANNELS,
  type SuppressionChannel,
  SuppressionService,
  createServiceContext,
} from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:suppression-list')

// Cross-product suppression-list export (cursor-paginated) — lets other
// products mirror the shared suppression list. Contract: docs/CONSENT_API.md.
//
// Expected payload:
//   { cursor?: string, limit?: number (<=200), channel?: string }
//
// Response: { entries: [...], next_cursor, has_more }
//
// Secret: PHYND_CONSENT_EVENTS_SECRET.
export async function POST(req: Request) {
  const secret = process.env.PHYND_CONSENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Consent events secret not configured' }, { status: 503 })
  }

  const parsed = await parseSignedWebhookRequest(req, secret)
  if (!parsed.ok) {
    return parsed.response
  }

  const cursor = parsed.payload.cursor as string | undefined
  const channel = parsed.payload.channel as string | undefined
  const limitRaw = parsed.payload.limit as number | string | undefined
  const limitParsed =
    typeof limitRaw === 'number' ? limitRaw : limitRaw ? Number.parseInt(limitRaw, 10) : undefined
  const limit =
    limitParsed && !Number.isNaN(limitParsed) ? Math.min(Math.max(limitParsed, 1), 200) : undefined

  if (channel && !(SUPPRESSION_CHANNELS as readonly string[]).includes(channel)) {
    return NextResponse.json({ error: `Invalid channel: ${channel}` }, { status: 400 })
  }

  try {
    const tenantId = resolveTenantIdForWebhook(req)
    const db = getDb(tenantId)
    const service = new SuppressionService(
      createServiceContext(db, {} as never, {
        userId: 'service:suppression-list',
        tenantId,
        roles: ['service'],
        scopes: ['consent:read'],
        accessToken: '',
      }),
    )

    const result = await service.list(
      { cursor, limit },
      channel ? { channel: channel as SuppressionChannel } : undefined,
    )

    return NextResponse.json(
      {
        entries: result.items.map((entry) => ({
          id: entry.id,
          identifier: entry.identifier,
          channel: entry.channel,
          reason: entry.reason,
          source: entry.source,
          created_at: entry.createdAt.toISOString(),
        })),
        next_cursor: result.nextCursor,
        has_more: result.hasMore,
      },
      { headers: { 'X-RateLimit-Remaining': String(parsed.remaining) } },
    )
  } catch (error) {
    logger.error({ err: error }, 'suppression list failed')
    return NextResponse.json({ error: 'Suppression list failed' }, { status: 500 })
  }
}

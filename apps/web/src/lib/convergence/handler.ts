/**
 * Shared GET handler for `/api/v1/convergence/{leads,opportunities}` — the
 * read API converge-dash (dash.madfam.io) ingests the CRM pipeline from.
 * Contract and rules: docs/CONVERGENCE_API.md.
 *
 * Order: rate limit → bearer auth → period → tenant scope → read. The body
 * is the bare JSON array converge-dash validates; errors are `{ error }`.
 */
import { checkApiRateLimit } from '@/lib/rate-limiter'
import { resolveDatabaseUrl } from '@phynd/config/connections'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  ConvergenceFeedService,
  type ConvergencePeriod,
  type FeedResult,
  type OmitReason,
} from '@phynd/services/convergence/convergence-feed'
import { NextResponse } from 'next/server'
import {
  CONVERGENCE_AUTH_MESSAGES,
  parseConvergencePeriod,
  resolveConvergenceTenants,
  verifyConvergenceBearer,
} from './request'

const logger = createLogger('web:convergence')

/** Same budget as Dhanam's convergence controller. */
const RATE_LIMIT_PER_MINUTE = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

export type ConvergenceFeedName = 'leads' | 'opportunities'

type FeedReader<T> = (
  service: ConvergenceFeedService,
  period: ConvergencePeriod,
) => Promise<FeedResult<T>>

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1'
}

export function createConvergenceHandler<T>(feed: ConvergenceFeedName, read: FeedReader<T>) {
  return async function GET(request: Request): Promise<Response> {
    const ip = clientIp(request)
    const { allowed } = await checkApiRateLimit(`convergence:${ip}`, {
      maxRequests: RATE_LIMIT_PER_MINUTE,
    })
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { ...NO_STORE, 'Retry-After': '60' } },
      )
    }

    const auth = verifyConvergenceBearer(request.headers.get('authorization'))
    if (!auth.ok) {
      const context = { feed, failure: auth.failure, ip }
      if (auth.failure === 'not_configured') {
        logger.error(context, 'convergence request rejected: CONVERGENCE_API_TOKEN unset')
      } else {
        logger.warn(context, 'convergence request rejected')
      }
      return NextResponse.json(
        { error: CONVERGENCE_AUTH_MESSAGES[auth.failure] },
        { status: 401, headers: { ...NO_STORE, 'WWW-Authenticate': 'Bearer' } },
      )
    }

    const parsed = parseConvergencePeriod(new URL(request.url).searchParams)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE })
    }
    const { period } = parsed

    try {
      const tenants = resolveConvergenceTenants(resolveDatabaseUrl)
      const results = await Promise.all(
        tenants.map((tenantId) => read(new ConvergenceFeedService(getDb(tenantId)), period)),
      )

      const items = results.flatMap((result) => result.items)
      const omitted: Partial<Record<OmitReason, number>> = {}
      for (const result of results) {
        for (const [reason, count] of Object.entries(result.omitted) as [OmitReason, number][]) {
          omitted[reason] = (omitted[reason] ?? 0) + count
        }
      }
      logger.info(
        {
          feed,
          tenants,
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
          returned: items.length,
          omitted,
        },
        'convergence feed served',
      )
      return NextResponse.json(items, { headers: NO_STORE })
    } catch (err) {
      logger.error({ err, feed }, 'convergence feed failed')
      return NextResponse.json(
        { error: 'Convergence feed unavailable' },
        { status: 500, headers: NO_STORE },
      )
    }
  }
}

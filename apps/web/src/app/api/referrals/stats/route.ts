/**
 * GET /api/referrals/stats?owner_janua_id=xxx
 *
 * Federation-authenticated endpoint for retrieving referral stats for a user.
 */

import { validateFederationAuth } from '../_lib/auth'
import { getDb } from '@phyne/db'
import { createLogger } from '@phyne/logging'
import { ReferralService, createServiceContext } from '@phyne/services'
import { getCacheManager } from '@/lib/federation/clients'
import type { AuthContext } from '@phyne/types/auth'
import { NextResponse } from 'next/server'

const logger = createLogger('api:referrals:stats')

const SERVICE_AUTH: AuthContext = {
  userId: 'service:federation',
  tenantId: 'madfam',
  roles: ['service'],
  scopes: [],
  accessToken: '',
}

export async function GET(req: Request) {
  const authResult = validateFederationAuth(req)
  if (!authResult.valid) {
    return authResult.response
  }

  const url = new URL(req.url)
  const ownerJanuaId = url.searchParams.get('owner_janua_id')

  if (!ownerJanuaId) {
    return NextResponse.json(
      { error: 'Missing required query parameter: owner_janua_id' },
      { status: 400 },
    )
  }

  try {
    const db = getDb()
    const cache = getCacheManager()
    const ctx = createServiceContext(db, cache, SERVICE_AUTH)
    const service = new ReferralService(ctx)

    const stats = await service.getStats(ownerJanuaId)

    return NextResponse.json({
      total_codes: stats.totalCodes,
      total_referrals: stats.totalReferrals,
      by_status: stats.byStatus,
      conversion_rate: stats.conversionRate,
    })
  } catch (err) {
    logger.error({ err }, 'Error fetching referral stats')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

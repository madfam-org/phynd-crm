/**
 * POST /api/referrals/validate
 *
 * Public endpoint (rate-limited only) for validating a referral code.
 * External products call this to check if a code is valid before applying it.
 */

import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { getDb } from '@phyne/db'
import { createLogger } from '@phyne/logging'
import { ReferralService, createServiceContext } from '@phyne/services'
import { getCacheManager } from '@/lib/federation/clients'
import type { AuthContext } from '@phyne/types/auth'
import { NextResponse } from 'next/server'

const logger = createLogger('api:referrals:validate')

const SERVICE_AUTH: AuthContext = {
  userId: 'service:federation',
  tenantId: 'madfam',
  roles: ['service'],
  scopes: [],
  accessToken: '',
}

export async function POST(req: Request) {
  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed } = await checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { code } = body
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Missing required field: code' }, { status: 400 })
  }

  try {
    const db = getDb()
    const cache = getCacheManager()
    const ctx = createServiceContext(db, cache, SERVICE_AUTH)
    const service = new ReferralService(ctx)

    const result = await service.validateCode(code)

    if (!result) {
      return NextResponse.json({ valid: false })
    }

    return NextResponse.json({
      valid: true,
      code: {
        id: result.id,
        code: result.code,
        owner_janua_id: result.ownerJanuaId,
        source_product: result.sourceProduct,
        current_uses: result.currentUses,
        max_uses: result.maxUses,
        expires_at: result.expiresAt?.toISOString() ?? null,
      },
    })
  } catch (err) {
    logger.error({ err }, 'Error validating referral code')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

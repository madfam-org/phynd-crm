/**
 * POST /api/referrals/apply
 *
 * Federation-authenticated endpoint for applying a referral.
 * External products call this when a user signs up with a referral code.
 */

import { getCacheManager } from '@/lib/federation/clients'
import { DEFAULT_TENANT_ID } from '@phyne/config/constants'
import { getDb } from '@phyne/db'
import { createLogger } from '@phyne/logging'
import { ReferralService, createServiceContext } from '@phyne/services'
import type { AuthContext } from '@phyne/types/auth'
import { NextResponse } from 'next/server'
import { validateFederationAuth } from '../_lib/auth'

const logger = createLogger('api:referrals:apply')

export async function POST(req: Request) {
  const authResult = validateFederationAuth(req)
  if (!authResult.valid) {
    return authResult.response
  }

  let body: {
    code?: string
    referred_email?: string
    referred_name?: string
    source_product?: string
    target_product?: string
    referred_janua_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { code, referred_email, referred_name, source_product, target_product } = body

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Missing required field: code' }, { status: 400 })
  }
  if (!referred_email || typeof referred_email !== 'string') {
    return NextResponse.json({ error: 'Missing required field: referred_email' }, { status: 400 })
  }
  if (!source_product || typeof source_product !== 'string') {
    return NextResponse.json({ error: 'Missing required field: source_product' }, { status: 400 })
  }
  if (!target_product || typeof target_product !== 'string') {
    return NextResponse.json({ error: 'Missing required field: target_product' }, { status: 400 })
  }

  try {
    // Service context uses the referred user's janua ID if provided,
    // falling back to federation service identity. The userId is checked
    // against the referral code owner for anti-abuse (self-referral prevention).
    const userId = body.referred_janua_id ?? 'service:federation'
    const serviceAuth: AuthContext = {
      userId,
      tenantId: DEFAULT_TENANT_ID,
      roles: ['service'],
      scopes: [],
      accessToken: '',
    }

    const db = getDb()
    const cache = getCacheManager()
    const ctx = createServiceContext(db, cache, serviceAuth)
    const service = new ReferralService(ctx)

    const referral = await service.applyReferral(
      code,
      referred_email,
      referred_name ?? null,
      source_product,
      target_product,
    )

    return NextResponse.json({
      referral_id: referral.id,
      status: 'applied',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    // Known validation errors return 400
    if (
      message.includes('Invalid or expired') ||
      message.includes('Self-referrals') ||
      message.includes('Disposable email')
    ) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    // Pipeline config errors return 422
    if (message.includes('No default pipeline') || message.includes('No stages found')) {
      logger.error({ err }, 'Pipeline configuration error during referral apply')
      return NextResponse.json({ error: message }, { status: 422 })
    }

    logger.error({ err }, 'Error applying referral')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/referrals/apply
 *
 * Federation-authenticated endpoint for applying a referral.
 * External products call this when a user signs up with a referral code.
 */

import { getCacheManager } from '@/lib/federation/clients'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { ReferralService, createServiceContext } from '@phynd/services'
import type { AuthContext } from '@phynd/types/auth'
import { NextResponse } from 'next/server'
import { validateFederationAuth } from '../_lib/auth'

const logger = createLogger('api:referrals:apply')

type ApplyReferralBody = {
  code?: string
  referred_email?: string
  referred_name?: string
  source_product?: string
  target_product?: string
  referred_janua_id?: string
}

function validationError(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

async function readApplyReferralBody(req: Request) {
  try {
    return { body: (await req.json()) as ApplyReferralBody }
  } catch {
    return { response: validationError('Invalid JSON') }
  }
}

function validateApplyReferralBody(body: ApplyReferralBody) {
  const { code, referred_email, referred_name, source_product, target_product } = body

  if (!code || typeof code !== 'string') {
    return validationError('Missing required field: code')
  }
  if (!referred_email || typeof referred_email !== 'string') {
    return validationError('Missing required field: referred_email')
  }
  if (!source_product || typeof source_product !== 'string') {
    return validationError('Missing required field: source_product')
  }
  if (!target_product || typeof target_product !== 'string') {
    return validationError('Missing required field: target_product')
  }

  return { code, referred_email, referred_name, source_product, target_product }
}

function serviceAuthForApply(body: ApplyReferralBody): AuthContext {
  return {
    userId: body.referred_janua_id ?? 'service:federation',
    tenantId: DEFAULT_TENANT_ID,
    roles: ['service'],
    scopes: [],
    accessToken: '',
  }
}

function applyReferralErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unknown error'

  if (
    message.includes('Invalid or expired') ||
    message.includes('Self-referrals') ||
    message.includes('Disposable email')
  ) {
    return validationError(message)
  }

  if (message.includes('No default pipeline') || message.includes('No stages found')) {
    logger.error({ err }, 'Pipeline configuration error during referral apply')
    return NextResponse.json({ error: message }, { status: 422 })
  }

  logger.error({ err }, 'Error applying referral')
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function POST(req: Request) {
  const authResult = validateFederationAuth(req)
  if (!authResult.valid) {
    return authResult.response
  }

  const parsed = await readApplyReferralBody(req)
  if ('response' in parsed) {
    return parsed.response
  }

  const validated = validateApplyReferralBody(parsed.body)
  if (validated instanceof NextResponse) {
    return validated
  }

  try {
    const db = getDb()
    const cache = getCacheManager()
    const ctx = createServiceContext(db, cache, serviceAuthForApply(parsed.body))
    const service = new ReferralService(ctx)

    const referral = await service.applyReferral(
      validated.code,
      validated.referred_email,
      validated.referred_name ?? null,
      validated.source_product,
      validated.target_product,
    )

    return NextResponse.json({
      referral_id: referral.id,
      status: 'applied',
    })
  } catch (err) {
    return applyReferralErrorResponse(err)
  }
}

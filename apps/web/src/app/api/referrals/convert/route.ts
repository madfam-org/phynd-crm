/**
 * POST /api/referrals/convert
 *
 * Federation-authenticated endpoint for converting a referral.
 * External products call this when a referred user completes a paid conversion.
 * Enqueues a BullMQ job to dispatch a webhook to Dhanam for reward application.
 */

import { validateFederationAuth } from '../_lib/auth'
import { getDb } from '@phyne/db'
import { createLogger } from '@phyne/logging'
import { ReferralService, createServiceContext } from '@phyne/services'
import { getCacheManager } from '@/lib/federation/clients'
import type { AuthContext } from '@phyne/types/auth'
import { NextResponse } from 'next/server'
import { Queue } from 'bullmq'

const logger = createLogger('api:referrals:convert')

const SERVICE_AUTH: AuthContext = {
  userId: 'service:federation',
  tenantId: 'madfam',
  roles: ['service'],
  scopes: [],
  accessToken: '',
}

function createRedisConnection(redisUrl: string) {
  const url = new URL(redisUrl)
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
  }
}

export async function POST(req: Request) {
  const authResult = validateFederationAuth(req)
  if (!authResult.valid) {
    return authResult.response
  }

  let body: {
    referral_id?: string
    plan_id?: string
    revenue_cents?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { referral_id, plan_id, revenue_cents } = body

  if (!referral_id || typeof referral_id !== 'string') {
    return NextResponse.json({ error: 'Missing required field: referral_id' }, { status: 400 })
  }
  if (!plan_id || typeof plan_id !== 'string') {
    return NextResponse.json({ error: 'Missing required field: plan_id' }, { status: 400 })
  }
  if (revenue_cents === undefined || typeof revenue_cents !== 'number') {
    return NextResponse.json({ error: 'Missing required field: revenue_cents' }, { status: 400 })
  }

  try {
    const db = getDb()
    const cache = getCacheManager()
    const ctx = createServiceContext(db, cache, SERVICE_AUTH)
    const service = new ReferralService(ctx)

    const result = await service.convertReferral(referral_id, plan_id, revenue_cents)

    // Enqueue BullMQ job to dispatch webhook to Dhanam
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
    const connection = createRedisConnection(redisUrl)
    const queue = new Queue('referral-reward-dispatch', { connection })

    await queue.add('dispatch', {
      referralId: result.id,
      referralCode: result.code?.code ?? '',
      referrerUserId: result.referrerJanuaId,
      referredUserId: result.referredJanuaId ?? '',
      referredEmail: result.referredEmail ?? '',
      sourceProduct: result.sourceProduct,
      targetProduct: result.targetProduct,
      planId: plan_id,
      revenueCents: revenue_cents,
    })
    await queue.close()

    logger.info(
      { referralId: referral_id, planId: plan_id, revenueCents: revenue_cents },
      'Referral converted and reward dispatch enqueued',
    )

    return NextResponse.json({
      referral_id: result.id,
      status: 'converted',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    if (message === 'Referral not found') {
      return NextResponse.json({ error: message }, { status: 404 })
    }

    logger.error({ err }, 'Error converting referral')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/referrals/convert
 *
 * Federation-authenticated endpoint for converting a referral.
 * External products call this when a referred user completes a paid conversion.
 * Enqueues a BullMQ job to dispatch a webhook to Dhanam for reward application.
 */

import { getCacheManager } from '@/lib/federation/clients'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { ReferralService, createServiceContext } from '@phynd/services'
import type { AuthContext } from '@phynd/types/auth'
import { Queue } from 'bullmq'
import { NextResponse } from 'next/server'
import { validateFederationAuth } from '../_lib/auth'

const logger = createLogger('api:referrals:convert')

const SERVICE_AUTH: AuthContext = {
  userId: 'service:federation',
  tenantId: DEFAULT_TENANT_ID,
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

type ConvertReferralBody = {
  referral_id?: string
  plan_id?: string
  revenue_cents?: number
}

async function readConvertReferralBody(req: Request) {
  try {
    return { body: (await req.json()) as ConvertReferralBody }
  } catch {
    return { response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  }
}

function validateConvertReferralBody(body: ConvertReferralBody) {
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

  return { referral_id, plan_id, revenue_cents }
}

async function enqueueRewardDispatch(
  result: Awaited<ReturnType<ReferralService['convertReferral']>>,
  planId: string,
  revenueCents: number,
) {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
  const connection = createRedisConnection(redisUrl)
  const queue = new Queue('referral-reward-dispatch', { connection })

  try {
    await queue.add('dispatch', {
      referralId: result.id,
      referralCode: result.code?.code ?? '',
      referrerUserId: result.referrerJanuaId,
      referredUserId: result.referredJanuaId ?? '',
      referredEmail: result.referredEmail ?? '',
      sourceProduct: result.sourceProduct,
      targetProduct: result.targetProduct,
      planId,
      revenueCents,
    })
  } finally {
    await queue.close()
  }
}

function convertReferralErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unknown error'

  if (message === 'Referral not found') {
    return NextResponse.json({ error: message }, { status: 404 })
  }

  logger.error({ err }, 'Error converting referral')
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export async function POST(req: Request) {
  const authResult = validateFederationAuth(req)
  if (!authResult.valid) {
    return authResult.response
  }

  const parsed = await readConvertReferralBody(req)
  if ('response' in parsed) {
    return parsed.response
  }

  const validated = validateConvertReferralBody(parsed.body)
  if (validated instanceof NextResponse) {
    return validated
  }

  try {
    const db = getDb()
    const cache = getCacheManager()
    const ctx = createServiceContext(db, cache, SERVICE_AUTH)
    const service = new ReferralService(ctx)

    const result = await service.convertReferral(
      validated.referral_id,
      validated.plan_id,
      validated.revenue_cents,
    )
    await enqueueRewardDispatch(result, validated.plan_id, validated.revenue_cents)

    logger.info(
      {
        referralId: validated.referral_id,
        planId: validated.plan_id,
        revenueCents: validated.revenue_cents,
      },
      'Referral converted and reward dispatch enqueued',
    )

    return NextResponse.json({
      referral_id: result.id,
      status: 'converted',
    })
  } catch (err) {
    return convertReferralErrorResponse(err)
  }
}

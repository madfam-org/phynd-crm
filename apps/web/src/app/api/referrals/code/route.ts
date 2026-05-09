/**
 * POST /api/referrals/code
 *
 * Federation-authenticated endpoint for generating a referral code.
 * External products call this to create a referral code for a user.
 */

import { getCacheManager } from '@/lib/federation/clients'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { ReferralService, createServiceContext } from '@phynd/services'
import type { AuthContext } from '@phynd/types/auth'
import { NextResponse } from 'next/server'
import { validateFederationAuth } from '../_lib/auth'

const logger = createLogger('api:referrals:code')

const SERVICE_AUTH: AuthContext = {
  userId: 'service:federation',
  tenantId: DEFAULT_TENANT_ID,
  roles: ['service'],
  scopes: [],
  accessToken: '',
}

export async function POST(req: Request) {
  const authResult = validateFederationAuth(req)
  if (!authResult.valid) {
    return authResult.response
  }

  let body: {
    owner_janua_id?: string
    owner_email?: string
    owner_name?: string
    source_product?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { owner_janua_id, owner_email, owner_name, source_product } = body

  if (!owner_janua_id || typeof owner_janua_id !== 'string') {
    return NextResponse.json({ error: 'Missing required field: owner_janua_id' }, { status: 400 })
  }
  if (!source_product || typeof source_product !== 'string') {
    return NextResponse.json({ error: 'Missing required field: source_product' }, { status: 400 })
  }

  try {
    const db = getDb()
    const cache = getCacheManager()
    const ctx = createServiceContext(db, cache, SERVICE_AUTH)
    const service = new ReferralService(ctx)

    const row = await service.generateCode(
      owner_janua_id,
      owner_email ?? null,
      owner_name ?? null,
      source_product,
    )

    return NextResponse.json({
      code: row.code,
      referral_code_id: row.id,
    })
  } catch (err) {
    logger.error({ err }, 'Error generating referral code')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Webhook receiver for Dhanam referral events.
 *
 * Receives `referral.applied` and `referral.converted` events from Dhanam's
 * centralized referral system. Creates/updates contacts, leads, and conversion
 * records in PhyneCRM linked to the "Referral Program" campaign.
 *
 * Signature: HMAC-SHA256 of raw body via X-Dhanam-Signature header.
 */

import { checkRateLimit } from '@/lib/webhooks/rate-limiter'
import { getDb } from '@phyne/db'
import { campaigns, contacts, conversions, leads, pipelines } from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:dhanam-referral')

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000 // 5 minutes

interface DhanamReferralPayload {
  id: string
  type: 'referral.applied' | 'referral.converted' | 'referral.rewarded' | 'ambassador.promoted'
  timestamp: string
  data: {
    referral_id: string
    referral_code: string
    referrer_user_id: string
    referrer_email?: string
    referrer_name?: string
    referred_user_id?: string
    referred_email?: string
    referred_name?: string
    source_product: string
    target_product: string
    plan_id?: string
    revenue_cents?: number
    rewards?: Array<{
      type: string
      amount: number
      recipient: string
    }>
  }
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  const secret = process.env.DHANAM_WEBHOOK_SECRET
  if (!secret) {
    logger.warn('DHANAM_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed } = await checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // Read body
  const rawBody = await req.text()

  // Verify HMAC signature
  const signature = req.headers.get('x-dhanam-signature') ?? ''
  if (!verifySignature(rawBody, signature, secret)) {
    logger.warn('Invalid Dhanam referral webhook signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Timestamp validation
  const timestamp = req.headers.get('x-webhook-timestamp')
  if (timestamp) {
    const age = Date.now() - new Date(timestamp).getTime()
    if (Number.isNaN(age) || age > MAX_TIMESTAMP_AGE_MS) {
      return NextResponse.json({ error: 'Timestamp expired' }, { status: 401 })
    }
  }

  let payload: DhanamReferralPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, data } = payload

  logger.info({ type, referralCode: data.referral_code }, 'Dhanam referral webhook received')

  try {
    const db = getDb()

    if (type === 'referral.applied') {
      await handleReferralApplied(db, data)
    } else if (type === 'referral.converted') {
      await handleReferralConverted(db, data)
    }

    return NextResponse.json({ status: 'ok', type })
  } catch (err) {
    logger.error({ err, type }, 'Error processing Dhanam referral webhook')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

async function handleReferralApplied(
  db: ReturnType<typeof getDb>,
  data: DhanamReferralPayload['data'],
) {
  const email = data.referred_email
  if (!email) return

  // Create or find contact for the referred user
  const existingContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.email, email))
    .limit(1)

  let contactId: string
  if (existingContacts.length > 0) {
    contactId = existingContacts[0]!.id
  } else {
    const [newContact] = await db
      .insert(contacts)
      .values({
        name: data.referred_name ?? email.split('@')[0] ?? 'Referral',
        email,
        source: 'referral',
        status: 'active',
      })
      .returning()
    contactId = newContact!.id
  }

  // Find the referral campaign
  const [referralCampaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.channel, 'referral'))
    .limit(1)

  // Find the default pipeline and first stage
  const [defaultPipeline] = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.isDefault, true))
    .limit(1)

  if (!defaultPipeline) {
    logger.warn('No default pipeline found for referral lead creation')
    return
  }

  const pipelineStagesTable = await import('@phyne/db/schema').then((m) => m.pipelineStages)
  const [firstStage] = await db
    .select()
    .from(pipelineStagesTable)
    .where(eq(pipelineStagesTable.pipelineId, defaultPipeline.id))
    .orderBy(pipelineStagesTable.position)
    .limit(1)

  if (!firstStage) return

  // Create a lead for the referral
  await db.insert(leads).values({
    contactId,
    pipelineId: defaultPipeline.id,
    stageId: firstStage.id,
    source: 'referral',
    status: 'open',
    score: 60, // Referrals start with moderate score
  })

  logger.info(
    { email, referralCode: data.referral_code, contactId },
    'Referral lead created in CRM',
  )
}

async function handleReferralConverted(
  db: ReturnType<typeof getDb>,
  data: DhanamReferralPayload['data'],
) {
  const email = data.referred_email
  if (!email) return

  // Find the contact
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.email, email))
    .limit(1)

  if (!contact) return

  // Find the referral campaign for conversion attribution
  const [referralCampaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.channel, 'referral'))
    .limit(1)

  // Record the conversion
  await db.insert(conversions).values({
    type: 'referral_conversion',
    contactId: contact.id,
    campaignId: referralCampaign?.id,
    value: data.revenue_cents ? String(data.revenue_cents / 100) : '0',
    metadata: {
      referral_code: data.referral_code,
      referrer_user_id: data.referrer_user_id,
      source_product: data.source_product,
      target_product: data.target_product,
      plan_id: data.plan_id,
    },
    convertedAt: new Date(),
  })

  // Update campaign spend
  if (referralCampaign) {
    const currentSpend = Number.parseFloat(referralCampaign.spend ?? '0')
    const rewardCost = data.revenue_cents ? data.revenue_cents / 100 : 0
    await db
      .update(campaigns)
      .set({ spend: String(currentSpend + rewardCost) })
      .where(eq(campaigns.id, referralCampaign.id))
  }

  logger.info(
    { email, referralCode: data.referral_code, revenueCents: data.revenue_cents },
    'Referral conversion recorded in CRM',
  )
}

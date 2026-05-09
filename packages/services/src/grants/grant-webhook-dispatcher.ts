import crypto from 'node:crypto'
import { createLogger } from '@phynd/logging'

const logger = createLogger('services:grant-webhook-dispatcher')

interface GrantAwardedPayload {
  event: 'grant.awarded'
  data: {
    grantApplicationId: string
    grantOpportunityId: string
    fortunaGrantId: string
    title: string
    awardedAmount: string | null
    rfc?: string
  }
  timestamp: string
}

export async function dispatchGrantAwarded(payload: {
  grantApplicationId: string
  grantOpportunityId: string
  fortunaGrantId: string
  title: string
  awardedAmount: string | null
  rfc?: string
}): Promise<void> {
  const karafielUrl = process.env.KARAFIEL_API_URL
  const secret = process.env.KARAFIEL_WEBHOOK_SECRET

  if (!karafielUrl || !secret) {
    logger.warn('KARAFIEL_API_URL or KARAFIEL_WEBHOOK_SECRET not configured — skipping dispatch')
    return
  }

  const webhookPayload: GrantAwardedPayload = {
    event: 'grant.awarded',
    data: {
      grantApplicationId: payload.grantApplicationId,
      grantOpportunityId: payload.grantOpportunityId,
      fortunaGrantId: payload.fortunaGrantId,
      title: payload.title,
      awardedAmount: payload.awardedAmount,
      rfc: payload.rfc,
    },
    timestamp: new Date().toISOString(),
  }

  const body = JSON.stringify(webhookPayload)
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')

  const url = `${karafielUrl}/webhooks/phynd-crm`

  logger.info(
    { grantApplicationId: payload.grantApplicationId, url },
    'Dispatching grant.awarded webhook to Karafiel',
  )

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PhyndCRM-Signature': signature,
      'X-Webhook-Timestamp': webhookPayload.timestamp,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown')
    logger.error(
      { status: response.status, body: text, grantApplicationId: payload.grantApplicationId },
      'Karafiel webhook dispatch failed',
    )
    throw new Error(`Karafiel webhook dispatch failed with status ${response.status}`)
  }

  logger.info(
    { grantApplicationId: payload.grantApplicationId },
    'grant.awarded webhook dispatched successfully',
  )
}

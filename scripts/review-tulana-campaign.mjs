#!/usr/bin/env node
import crypto from 'node:crypto'
import process from 'node:process'

function usage() {
  console.error(
    [
      'Usage:',
      '  PHYND_CAMPAIGN_IMPORT_SECRET=... node scripts/review-tulana-campaign.mjs <campaign_id> <approved|rejected>',
      '',
      'Optional env:',
      '  PHYND_CAMPAIGN_REVIEW_URL=https://crm.madfam.io/api/v1/campaigns/review',
      '  PHYND_WEBHOOK_HOST=crm.madfam.io',
    ].join('\n'),
  )
}

const campaignId = process.argv[2]
const decision = process.argv[3]
if (!campaignId || (decision !== 'approved' && decision !== 'rejected')) {
  usage()
  process.exit(2)
}

const secret = process.env.PHYND_CAMPAIGN_IMPORT_SECRET
if (!secret) {
  console.error('PHYND_CAMPAIGN_IMPORT_SECRET is required')
  process.exit(2)
}

const url =
  process.env.PHYND_CAMPAIGN_REVIEW_URL ||
  'https://crm.madfam.io/api/v1/campaigns/review'
const host = process.env.PHYND_WEBHOOK_HOST
const body = JSON.stringify({ campaign_id: campaignId, decision })
const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')

const headers = {
  'content-type': 'application/json',
  'x-webhook-signature': `sha256=${signature}`,
  'x-webhook-timestamp': new Date().toISOString(),
}
if (host) {
  headers.host = host
}

const response = await fetch(url, {
  method: 'POST',
  headers,
  body,
})

const responseText = await response.text()
if (!response.ok) {
  console.error(`PhyndCRM campaign review failed: HTTP ${response.status}`)
  if (responseText) {
    console.error(responseText)
  }
  process.exit(1)
}

console.log('PhyndCRM campaign review accepted')
console.log(`- url: ${url}`)
console.log(`- campaign_id: ${campaignId}`)
console.log(`- decision: ${decision}`)
console.log(`- status: ${response.status}`)
if (responseText) {
  console.log(`- response: ${responseText}`)
}

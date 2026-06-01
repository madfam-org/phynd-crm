#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import process from 'node:process'

function usage() {
  console.error(
    [
      'Usage:',
      '  PHYND_CAMPAIGN_IMPORT_SECRET=... node scripts/import-tulana-campaign.mjs <payload.json>',
      '',
      'Optional env:',
      '  PHYND_CAMPAIGN_IMPORT_URL=https://crm.madfam.io/api/v1/campaigns/import',
      '  PHYND_WEBHOOK_HOST=crm.madfam.io',
    ].join('\n'),
  )
}

const payloadPath = process.argv[2]
if (!payloadPath) {
  usage()
  process.exit(2)
}

const secret = process.env.PHYND_CAMPAIGN_IMPORT_SECRET
if (!secret) {
  console.error('PHYND_CAMPAIGN_IMPORT_SECRET is required')
  process.exit(2)
}

const url =
  process.env.PHYND_CAMPAIGN_IMPORT_URL ||
  'https://crm.madfam.io/api/v1/campaigns/import'
const host = process.env.PHYND_WEBHOOK_HOST
const raw = fs.readFileSync(payloadPath, 'utf8')
const parsed = JSON.parse(raw)
const body = JSON.stringify(parsed)
const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')
const timestamp = new Date().toISOString()

const headers = {
  'content-type': 'application/json',
  'x-webhook-signature': `sha256=${signature}`,
  'x-webhook-timestamp': timestamp,
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
  console.error(`PhyndCRM campaign import failed: HTTP ${response.status}`)
  if (responseText) {
    console.error(responseText)
  }
  process.exit(1)
}

console.log('PhyndCRM campaign import accepted')
console.log(`- url: ${url}`)
console.log(`- payload: ${payloadPath}`)
console.log(`- status: ${response.status}`)
if (responseText) {
  console.log(`- response: ${responseText}`)
}

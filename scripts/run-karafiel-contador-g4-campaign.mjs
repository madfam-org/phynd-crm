#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import process from 'node:process'

function usage() {
  console.error(
    [
      'Usage:',
      '  PHYND_CAMPAIGN_IMPORT_SECRET=... PHYND_G4_APPROVAL_CONFIRMATION=approved node scripts/run-karafiel-contador-g4-campaign.mjs <payload.json> <contact_id>',
      '',
      'Required:',
      '  PHYND_CAMPAIGN_IMPORT_SECRET',
      '  PHYND_G4_APPROVAL_CONFIRMATION=approved',
      '',
      'Optional env:',
      '  PHYND_CAMPAIGN_IMPORT_URL=https://phynecrm.madfam.io/api/v1/campaigns/import',
      '  PHYND_CAMPAIGN_REVIEW_URL=https://phynecrm.madfam.io/api/v1/campaigns/review',
      '  PHYND_CAMPAIGN_SEND_URL=https://phynecrm.madfam.io/api/v1/campaigns/send',
      '  PHYND_WEBHOOK_HOST=crm.madfam.io',
      '  PHYND_G4_CAMPAIGN_ID=<campaign id if import response does not return one>',
    ].join('\n'),
  )
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function optionalEnv(name, fallback) {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : fallback
}

function signBody(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function signedHeaders(secret, body) {
  const headers = {
    'content-type': 'application/json',
    'x-webhook-signature': `sha256=${signBody(secret, body)}`,
    'x-webhook-timestamp': new Date().toISOString(),
  }

  const host = process.env.PHYND_WEBHOOK_HOST
  if (host) {
    headers.host = host
  }

  return headers
}

async function postSigned({ url, secret, body, label }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: signedHeaders(secret, body),
    body,
  })

  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}${responseText ? ` ${responseText}` : ''}`)
  }

  let parsed = null
  if (responseText) {
    try {
      parsed = JSON.parse(responseText)
    } catch {
      parsed = { raw_response: responseText }
    }
  }

  return {
    status: response.status,
    body: parsed,
  }
}

function extractCampaignId(body) {
  const candidates = [
    body?.campaign_id,
    body?.campaignId,
    body?.id,
    body?.campaign?.campaign_id,
    body?.campaign?.campaignId,
    body?.campaign?.id,
    body?.data?.campaign_id,
    body?.data?.campaignId,
    body?.data?.id,
    body?.data?.campaign?.campaign_id,
    body?.data?.campaign?.campaignId,
    body?.data?.campaign?.id,
    body?.result?.campaign_id,
    body?.result?.campaignId,
    body?.result?.id,
  ]

  return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim()
}

async function main() {
  const payloadPath = process.argv[2]
  const contactId = process.argv[3]
  if (!payloadPath || !contactId) {
    usage()
    process.exit(2)
  }

  const approvalConfirmation = requireEnv('PHYND_G4_APPROVAL_CONFIRMATION')
  if (approvalConfirmation !== 'approved') {
    throw new Error('Refusing to continue unless PHYND_G4_APPROVAL_CONFIRMATION=approved')
  }

  const secret = requireEnv('PHYND_CAMPAIGN_IMPORT_SECRET')
  const importUrl = optionalEnv(
    'PHYND_CAMPAIGN_IMPORT_URL',
    'https://phynecrm.madfam.io/api/v1/campaigns/import',
  )
  const reviewUrl = optionalEnv(
    'PHYND_CAMPAIGN_REVIEW_URL',
    'https://phynecrm.madfam.io/api/v1/campaigns/review',
  )
  const sendUrl = optionalEnv('PHYND_CAMPAIGN_SEND_URL', 'https://phynecrm.madfam.io/api/v1/campaigns/send')

  const rawPayload = fs.readFileSync(payloadPath, 'utf8')
  const importBody = JSON.stringify(JSON.parse(rawPayload))

  const imported = await postSigned({
    url: importUrl,
    secret,
    body: importBody,
    label: 'PhyndCRM campaign import',
  })

  const campaignId = extractCampaignId(imported.body) || optionalEnv('PHYND_G4_CAMPAIGN_ID')
  if (!campaignId) {
    throw new Error(
      'Campaign import succeeded but no campaign id was returned. Set PHYND_G4_CAMPAIGN_ID and rerun review/send manually.',
    )
  }

  const reviewed = await postSigned({
    url: reviewUrl,
    secret,
    body: JSON.stringify({ campaign_id: campaignId, decision: 'approved' }),
    label: 'PhyndCRM campaign review',
  })

  const sent = await postSigned({
    url: sendUrl,
    secret,
    body: JSON.stringify({ campaign_id: campaignId, contact_id: contactId }),
    label: 'PhyndCRM campaign send',
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        sku: 'karafiel__contador',
        gate_id: 'G4',
        campaign_id: campaignId,
        contact_id: contactId,
        import_status: imported.status,
        review_status: reviewed.status,
        send_status: sent.status,
        tulana_writeback_expected: true,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

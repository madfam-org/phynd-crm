#!/usr/bin/env node

import { createHmac } from 'node:crypto'

const DEFAULT_BASE_URL = 'https://staging-crm.madfam.io'

const simple = {
  type: 'simple',
  sign: (body, secret) => createHmac('sha256', secret).update(body).digest('hex'),
}

const madfam = {
  type: 'madfam',
  sign: (body, secret, ts) => {
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
    return `t=${ts},v1=${sig}`
  },
}

const lanes = {
  cotiza: {
    path: '/api/webhooks/cotiza',
    secretEnv: 'COTIZA_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: () => ({
      type: 'quote.updated',
      data: {
        id: 'pp5-cotiza-quote-001',
        contactId: 'pp5-contact-001',
        status: 'sent',
      },
    }),
  },
  forj: {
    path: '/api/webhooks/forj',
    secretEnv: 'FORJ_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: () => ({
      type: 'asset.updated',
      data: {
        id: 'pp5-forj-asset-001',
        externalId: 'forj://pp5/asset-001',
      },
    }),
  },
  pravara: {
    path: '/api/webhooks/pravara',
    secretEnv: 'PRAVARA_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: (opts) => ({
      event: 'status.changed',
      status: 'shipped',
      orderId: `pravara-pp5-${opts.runId}`,
      externalId: `pravara://pp5/${opts.runId}`,
      engagementId:
        opts.engagementId === 'REPLACE_WITH_STAGING_ENGAGEMENT_ID' ? undefined : opts.engagementId,
      metadata: { pp5_probe: true },
    }),
  },
  'janua-telemetry': {
    path: '/api/webhooks/janua-telemetry',
    secretEnv: 'JANUA_TELEMETRY_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: () => ({
      type: 'visitor.page_viewed',
      externalSessionId: 'pp5-session-001',
      pageViews: [
        {
          url: 'https://staging-crm.madfam.io/pp5-probe',
          title: 'PP.5 probe',
          duration: 3,
          viewedAt: new Date().toISOString(),
        },
      ],
    }),
  },
  janua: {
    path: '/api/webhooks/janua',
    secretEnv: 'JANUA_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: (opts) => ({
      type: 'user.created',
      data: {
        id: `janua-pp5-${opts.runId}`,
        email: opts.email,
        first_name: 'PP5',
        last_name: 'Probe',
        username: `pp5-${opts.runId}`,
      },
    }),
  },
  dhanam: {
    path: '/api/webhooks/dhanam',
    secretEnv: 'DHANAM_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-dhanam-signature',
    payload: (opts) => ({
      id: `evt_dhanam_pp5_${opts.runId}`,
      type: 'checkout.session.completed',
      timestamp: new Date().toISOString(),
      data: {
        customer_id: `janua-pp5-${opts.runId}`,
        customer_email: opts.email,
        amount_total: 25000,
        currency: 'mxn',
        subscription_id: `sub_pp5_${opts.runId}`,
        organization_id: 'org_pp5_staging',
        metadata: {
          referral_code: 'PP5-STAGING',
          plan_id: 'staging_probe',
        },
      },
    }),
  },
  fortuna: {
    path: '/api/webhooks/fortuna',
    secretEnv: 'FORTUNA_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-fortuna-signature',
    payload: (opts) => ({
      type: 'grant.discovered',
      data: {
        fortuna_grant_id: `fortuna-pp5-${opts.runId}`,
        title: 'PP.5 staging probe grant',
        granting_body: 'MADFAM staging',
        category: 'staging',
        funding_type: 'grant',
        min_amount: '10000.00',
        max_amount: '25000.00',
        currency: 'MXN',
        source_url: 'https://staging.fortuna.example/pp5',
        closes_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        relevance_score: '0.91',
        requirements_summary: 'Synthetic staging probe only',
        metadata: { pp5_probe: true },
      },
    }),
  },
  'tezca-interest': {
    path: '/api/webhooks/tezca',
    secretEnv: 'TEZCA_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: (opts) => ({
      type: 'interest.created',
      data: {
        email: opts.email,
        feature_key: 'pp5_probe',
        use_case: 'staging webhook validation',
        janua_user_id: `janua-pp5-${opts.runId}`,
        source_page: 'https://staging.tezca.example/pp5',
        created_at: new Date().toISOString(),
      },
    }),
  },
  'tezca-newsletter': {
    path: '/api/webhooks/tezca',
    secretEnv: 'TEZCA_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: (opts) => ({
      type: 'newsletter.subscribed',
      data: {
        email: opts.email,
        topics: ['pp5-staging'],
        source_page: 'https://staging.tezca.example/newsletter',
      },
    }),
  },
  routecraft: {
    path: '/api/webhooks/routecraft',
    secretEnv: 'PHYNE_CRM_EVENTS_SECRET',
    signature: madfam,
    signatureHeader: 'x-madfam-signature',
    payload: (opts) => paymentPayload('routecraft', opts),
  },
  'legacy-payment': {
    path: '/api/v1/events/payment.succeeded',
    secretEnv: 'PHYNE_CRM_EVENTS_SECRET',
    signature: madfam,
    signatureHeader: 'x-madfam-signature',
    payload: (opts) => paymentPayload('legacy', opts),
  },
  ceq: {
    path: '/api/webhooks/ceq',
    secretEnv: 'CEQ_WEBHOOK_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: (opts) => ({
      type: 'interest.created',
      data: {
        email: opts.email,
        feature_key: 'pp5_template',
        janua_user_id: `janua-pp5-${opts.runId}`,
        source_page: 'https://staging.ceq.example/templates/pp5',
        utm_source: 'pp5',
        utm_medium: 'staging',
        utm_campaign: 'pp5-staging-validation',
      },
    }),
  },
  coforma: {
    path: '/api/webhooks/coforma',
    secretEnv: 'COFORMA_WEBHOOK_SECRET',
    signature: madfam,
    signatureHeader: 'x-madfam-signature',
    extraHeaders: (opts) => ({
      'idempotency-key': `coforma-pp5-${opts.runId}`,
      'x-coforma-tenant-id': 'coforma-staging',
    }),
    payload: (opts) => ({
      type: 'cab.member.joined',
      data: {
        membershipId: `coforma-membership-pp5-${opts.runId}`,
        cabId: 'coforma-cab-pp5',
        cabSlug: 'pp5-staging',
        userEmail: opts.email,
        userName: 'PP5 Probe',
        company: 'MADFAM staging',
        title: 'Staging Probe',
        phynecrmContactId: null,
      },
    }),
  },
  'engagement-event': {
    path: '/api/v1/engagements/events',
    secretEnv: 'PHYNE_ENGAGEMENT_EVENTS_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: (opts) => ({
      engagement_id: opts.engagementId,
      source: 'cotiza',
      event_type: 'cotiza:pp5_probe',
      status: 'milestone',
      message: 'PP.5 staging event probe',
      timestamp: new Date().toISOString(),
      dedup_key: `pp5:event:${opts.runId}`,
      metadata: { pp5_probe: true },
    }),
  },
  'engagement-artifact': {
    path: '/api/v1/engagements/artifacts',
    secretEnv: 'PHYNE_ENGAGEMENT_EVENTS_SECRET',
    signature: simple,
    signatureHeader: 'x-webhook-signature',
    payload: (opts) => ({
      engagement_id: opts.engagementId,
      type: 'deliverable',
      entity_type: 'external_reference',
      entity_id: `pp5-artifact-${opts.runId}`,
      url: 'https://staging-crm.madfam.io/pp5-artifact',
      title: 'PP.5 staging artifact probe',
      metadata: { pp5_probe: true },
    }),
  },
}

function paymentPayload(provider, opts) {
  return {
    schema_version: '1',
    event_id: `evt_${provider}_pp5_${opts.runId}`,
    provider,
    subscription_id: `sub_pp5_${opts.runId}`,
    organization_id: 'org_pp5_staging',
    amount_minor: 25000,
    currency: 'MXN',
    occurred_at: new Date().toISOString(),
    attribution: {
      source_agent_id: `janua-pp5-${opts.runId}`,
      campaign_id: 'pp5-staging-validation',
      referral_code: 'PP5-STAGING',
      first_touch_at: new Date().toISOString(),
    },
    metadata: { pp5_probe: true },
  }
}

function parseArgs(argv) {
  const [command = 'list', laneName, ...rest] = argv
  const opts = {
    command,
    laneName,
    baseUrl: DEFAULT_BASE_URL,
    email: 'pp5-probe@staging.madfam.io',
    engagementId: 'REPLACE_WITH_STAGING_ENGAGEMENT_ID',
    runId: new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14),
  }

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    const value = rest[i + 1]
    if (!value) usage(`Missing value for ${arg}`)
    if (arg === '--base-url') opts.baseUrl = value.replace(/\/$/, '')
    else if (arg === '--email') opts.email = value
    else if (arg === '--engagement-id') opts.engagementId = value
    else if (arg === '--run-id') opts.runId = value
    else usage(`Unknown option: ${arg}`)
    i += 1
  }

  return opts
}

function usage(message) {
  if (message) console.error(`ERROR: ${message}`)
  console.error(`
Usage:
  node scripts/pp5-webhook-probe.mjs list
  node scripts/pp5-webhook-probe.mjs curl <lane> [--base-url URL] [--email EMAIL] [--engagement-id ID] [--run-id ID]
  node scripts/pp5-webhook-probe.mjs send <lane> [--base-url URL] [--email EMAIL] [--engagement-id ID] [--run-id ID]

The lane's secret must be set in the environment named by the lane, for example:
  COTIZA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs curl cotiza
`)
  process.exit(message ? 1 : 0)
}

function listLanes() {
  for (const [name, lane] of Object.entries(lanes)) {
    console.log(`${name}\t${lane.path}\t${lane.secretEnv}\t${lane.signatureHeader}`)
  }
}

function buildRequest(laneName, opts) {
  const lane = lanes[laneName]
  if (!lane) usage(`Unknown lane: ${laneName}`)

  const secret = process.env[lane.secretEnv]
  if (!secret) {
    usage(`Set ${lane.secretEnv} before generating a signed probe for ${laneName}`)
  }

  const body = JSON.stringify(lane.payload(opts))
  const ts = Math.floor(Date.now() / 1000)
  const signature = lane.signature.sign(body, secret, ts)
  const headers = {
    'content-type': 'application/json',
    [lane.signatureHeader]: signature,
    ...(lane.signature.type === 'simple' ? { 'x-webhook-timestamp': new Date().toISOString() } : {}),
    ...(lane.extraHeaders ? lane.extraHeaders(opts) : {}),
  }

  return {
    url: `${opts.baseUrl}${lane.path}`,
    body,
    headers,
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function printCurl(req) {
  const parts = ['curl', '-i', '-sS', '-X', 'POST']
  for (const [key, value] of Object.entries(req.headers)) {
    parts.push('-H', shellQuote(`${key}: ${value}`))
  }
  parts.push('--data-raw', shellQuote(req.body), shellQuote(req.url))
  console.log(parts.join(' '))
}

async function send(req) {
  const response = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
  })
  const text = await response.text()
  console.log(`HTTP ${response.status}`)
  console.log(text)
  if (!response.ok) process.exit(1)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.command === 'list') {
    listLanes()
    return
  }

  if (opts.command !== 'curl' && opts.command !== 'send') {
    usage(`Unknown command: ${opts.command}`)
  }

  const req = buildRequest(opts.laneName, opts)
  if (opts.command === 'curl') printCurl(req)
  else await send(req)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

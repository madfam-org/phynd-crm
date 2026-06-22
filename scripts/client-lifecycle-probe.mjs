#!/usr/bin/env node
/**
 * Synthetic probes for the client lifecycle seam (engagement events + Dhanam payment).
 *
 * Usage:
 *   CRM_BASE_URL=https://staging-phynd.app PHYND_ENGAGEMENT_EVENTS_SECRET=... \\
 *     node scripts/client-lifecycle-probe.mjs engagement-event --engagement-id <id>
 *
 *   CRM_BASE_URL=https://staging-phynd.app DHANAM_WEBHOOK_SECRET=... \\
 *     node scripts/client-lifecycle-probe.mjs dhanam-paid --engagement-id <id> --order-id <id>
 *
 *   node scripts/client-lifecycle-probe.mjs list
 */

import { createHmac, randomUUID } from 'node:crypto'

const DEFAULT_BASE = process.env.CRM_BASE_URL ?? 'http://localhost:3000'

const simpleSign = {
  header: 'x-webhook-signature',
  sign: (body, secret) => createHmac('sha256', secret).update(body).digest('hex'),
}

const lanes = {
  health: {
    method: 'GET',
    path: '/api/health',
    auth: false,
  },
  'engagement-event': {
    method: 'POST',
    path: '/api/v1/engagements/events',
    secretEnv: 'PHYND_ENGAGEMENT_EVENTS_SECRET',
    header: 'x-webhook-signature',
    sign: (body, secret) => createHmac('sha256', secret).update(body).digest('hex'),
    payload: (opts) => ({
      engagement_id: opts.engagementId,
      source: 'probe',
      event_type: 'probe:lifecycle_check',
      status: 'milestone',
      message: 'Client lifecycle probe event',
      dedup_key: `probe:lifecycle:${opts.runId}`,
    }),
  },
  'engagement-artifact': {
    method: 'POST',
    path: '/api/v1/engagements/artifacts',
    secretEnv: 'PHYND_ENGAGEMENT_EVENTS_SECRET',
    header: 'x-webhook-signature',
    sign: (body, secret) => createHmac('sha256', secret).update(body).digest('hex'),
    payload: (opts) => ({
      engagement_id: opts.engagementId,
      type: 'deliverable',
      title: `Probe deliverable ${opts.runId}`,
      url: 'https://example.com/probe-deliverable.pdf',
      metadata: { probe: true, run_id: opts.runId },
    }),
  },
  'dhanam-paid': {
    method: 'POST',
    path: '/api/webhooks/dhanam',
    secretEnv: 'DHANAM_WEBHOOK_SECRET',
    header: 'x-dhanam-signature',
    ...simpleSign,
    payload: (opts) => ({
      event: 'payment.paid',
      event_id: `probe-dhanam-${opts.runId}`,
      data: {
        amount_minor: opts.amountMinor ?? 100_00,
        currency: opts.currency ?? 'USD',
        engagement_id: opts.engagementId,
        order_id: opts.orderId,
        quote_id: opts.quoteId,
        payment_id: `pi_probe_${opts.runId}`,
      },
    }),
  },
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      flags.json = true
      continue
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i += 1
      } else {
        flags[key] = true
      }
      continue
    }
    positional.push(arg)
  }
  return {
    lane: positional[0] ?? 'list',
    base: flags.base ?? DEFAULT_BASE,
    engagementId: flags['engagement-id'] ?? flags.engagementId,
    orderId: flags['order-id'] ?? flags.orderId,
    quoteId: flags['quote-id'] ?? flags.quoteId,
    amountMinor: flags['amount-minor'] ? Number(flags['amount-minor']) : undefined,
    currency: flags.currency,
    json: Boolean(flags.json),
    runId: flags.runId ?? randomUUID().slice(0, 8),
  }
}

async function sendLane(laneName, options) {
  const lane = lanes[laneName]
  if (!lane) throw new Error(`Unknown lane: ${laneName}`)

  const url = `${options.base.replace(/\/$/, '')}${lane.path}`

  if (lane.method === 'GET') {
    const res = await fetch(url)
    const body = await res.text()
    return { lane: laneName, status: res.status, ok: res.ok, body: body.slice(0, 500) }
  }

  const secret = process.env[lane.secretEnv]
  if (!secret) {
    return { lane: laneName, ok: false, error: `Missing env ${lane.secretEnv}` }
  }

  if (!options.engagementId && laneName !== 'dhanam-paid') {
    return { lane: laneName, ok: false, error: 'Missing --engagement-id' }
  }

  const payload = lane.payload(options)
  const body = JSON.stringify(payload)
  const signature = lane.sign(body, secret)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [lane.header]: signature.startsWith('sha256=') ? signature : signature,
    },
    body,
  })
  const text = await res.text()
  return {
    lane: laneName,
    status: res.status,
    ok: res.ok,
    body: text.slice(0, 500),
  }
}

async function main() {
  const options = parseArgs(process.argv)

  if (options.lane === 'list') {
    const rows = Object.keys(lanes).map((name) => ({ name, ...lanes[name] }))
    if (options.json) console.log(JSON.stringify(rows, null, 2))
    else {
      for (const row of rows) {
        console.log(`${row.name}\t${row.method ?? 'POST'}\t${row.path}`)
      }
    }
    return
  }

  const result = await sendLane(options.lane, options)
  if (options.json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(result.ok ? `PASS ${result.lane} (${result.status})` : `FAIL ${result.lane}`)
    if (result.error) console.log(result.error)
    if (result.body) console.log(result.body)
  }
  process.exit(result.ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

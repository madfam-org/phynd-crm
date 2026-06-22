#!/usr/bin/env node
/**
 * Production client-lifecycle operator handoff — URLs, env gates, live probes.
 * Does not print secret values.
 *
 * Usage:
 *   node scripts/prod-lifecycle-handoff.mjs
 *   node scripts/prod-lifecycle-handoff.mjs --json
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROD_BASE = 'https://crm.madfam.io'
const PROD_ALT = 'https://phynd.app'

const PROVIDER_RECEIVERS = [
  {
    provider: 'Dhanam',
    method: 'POST',
    path: '/api/webhooks/dhanam',
    envKey: 'DHANAM_WEBHOOK_SECRET',
  },
  {
    provider: 'Pravara',
    method: 'POST',
    path: '/api/webhooks/pravara',
    envKey: 'PRAVARA_WEBHOOK_SECRET',
  },
  {
    provider: 'Cotiza / Pravara / Selva / Karafiel / Dhanam',
    method: 'POST',
    path: '/api/v1/engagements/events',
    envKey: 'PHYND_ENGAGEMENT_EVENTS_SECRET',
  },
  {
    provider: 'Cotiza / Karafiel / Dhanam / Selva',
    method: 'POST',
    path: '/api/v1/engagements/artifacts',
    envKey: 'PHYND_ENGAGEMENT_EVENTS_SECRET',
  },
]

function runNode(script, args) {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), script)
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })
}

function parseArgs(argv) {
  return { json: argv.includes('--json') }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))

  const envCheck = runNode('verify-client-lifecycle-env.mjs', [
    '--from-k8s',
    'production',
    '--json',
  ])
  let envReport = null
  try {
    envReport = JSON.parse(envCheck.stdout || '{}')
  } catch {
    envReport = { ok: false, parseError: true }
  }

  const health = spawnSync('curl', ['-fsS', `${PROD_BASE}/api/health`], { encoding: 'utf8' })
  const eso = spawnSync(
    'kubectl',
    [
      'get',
      'externalsecret',
      'phynd-crm-secrets',
      '-n',
      'phynd-crm',
      '-o',
      'jsonpath={.status.conditions[0].status}',
    ],
    { encoding: 'utf8' },
  )

  const handoff = {
    tier: 'production',
    baseUrls: [PROD_BASE, PROD_ALT],
    portalBaseUrl: 'https://phynd.app',
    providerReceivers: PROVIDER_RECEIVERS.map((row) => ({
      ...row,
      url: `${PROD_BASE}${row.path}`,
    })),
    exportCommands: [
      'node scripts/pp5-k8s-env.mjs --export-webhook-env --tier production',
      'node scripts/pp5-k8s-env.mjs --export-lifecycle-env --tier production',
    ],
    vaultBackfillDryRun:
      'VAULT_TOKEN=<write> node scripts/pp5-backfill-vault-from-k8s.mjs --tier production --dry-run',
    env: envReport,
    live: {
      healthOk: health.status === 0,
      externalSecretReady: (eso.stdout || '').trim() === 'True',
    },
    nextSteps: [
      'Register provider webhooks at the URLs above with freshly exported secrets (never reuse staging).',
      'Obtain PRAVARA_API_KEY from PravaraMES ops if API-key dispatch is required (HMAC via PHYNDCRM_OUTBOUND_SECRET is sufficient for dispatch worker).',
      'After Vault keys exist: run pp5-backfill-vault-from-k8s.mjs without --dry-run, extend external-secret.yaml, force-sync ESO.',
      'First prod onboard: staff flow on crm.madfam.io → publish quote → portal magic link → timeline milestones.',
    ],
  }

  if (opts.json) {
    console.log(JSON.stringify(handoff, null, 2))
    process.exit(envReport?.ok && handoff.live.healthOk ? 0 : 1)
  }

  console.log('Production client lifecycle handoff')
  console.log('')
  console.log('Base URLs:', handoff.baseUrls.join(', '))
  console.log('Portal:', handoff.portalBaseUrl)
  console.log('')
  console.log('Provider webhook destinations (share secrets via export commands below):')
  for (const row of handoff.providerReceivers) {
    console.log(`  ${row.provider}: ${row.method} ${row.url} (${row.envKey})`)
  }
  console.log('')
  console.log('Export secrets (operator shell only — do not commit output):')
  for (const cmd of handoff.exportCommands) {
    console.log(`  ${cmd}`)
  }
  console.log('')
  console.log(`Vault backfill plan: ${handoff.vaultBackfillDryRun}`)
  console.log('')
  console.log(`Live health (${PROD_BASE}/api/health): ${handoff.live.healthOk ? 'PASS' : 'FAIL'}`)
  console.log(`ExternalSecret phynd-crm-secrets: ${handoff.live.externalSecretReady ? 'Ready' : 'NOT Ready'}`)
  console.log('')
  if (envReport?.groups) {
    for (const group of envReport.groups) {
      console.log(group.ok ? `PASS ${group.name}` : `FAIL ${group.name}`)
      if (!group.ok) {
        for (const key of group.missing ?? []) console.log(`  missing: ${key}`)
      }
    }
    if (envReport.warnings?.length) {
      for (const w of envReport.warnings) console.log(`WARN ${w.key}: ${w.message}`)
    }
    console.log('')
    console.log(
      envReport.ok ? 'Client lifecycle env: PASS' : `Client lifecycle env: FAIL (${envReport.failedGroups})`,
    )
  } else {
    console.log('Client lifecycle env: could not parse verify output')
  }
  console.log('')
  console.log('Next steps:')
  for (const step of handoff.nextSteps) {
    console.log(`  - ${step}`)
  }

  process.exit(envReport?.ok && handoff.live.healthOk ? 0 : 1)
}

main()

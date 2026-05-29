#!/usr/bin/env node

import { spawn } from 'node:child_process'
import process from 'node:process'
import { STAGING_CRM_BASE_URL, applyStagingWebhookDefaults } from './staging-base-url.mjs'

const DEFAULT_BASE_URL = STAGING_CRM_BASE_URL
const DEFAULT_EMAIL = 'pp5-probe@staging.madfam.io'
const DEFAULT_RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const DEFAULT_PARALLELISM = 3
const INVALID_SECRET = '__pp5_invalid_probe_secret__'

const laneDefinitions = {
  cotiza: {
    secretEnv: 'COTIZA_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  karafiel: {
    secretEnv: 'KARAFIEL_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  forj: {
    secretEnv: 'FORJ_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  pravara: {
    secretEnv: 'PRAVARA_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  'janua-telemetry': {
    secretEnv: 'JANUA_TELEMETRY_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  janua: {
    secretEnv: 'JANUA_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  dhanam: {
    secretEnv: 'DHANAM_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  fortuna: {
    secretEnv: 'FORTUNA_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  'tezca-interest': {
    secretEnv: 'TEZCA_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  'tezca-newsletter': {
    secretEnv: 'TEZCA_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  routecraft: {
    secretEnv: 'PHYND_CRM_EVENTS_SECRET',
    mode: 'inbound',
  },
  'legacy-payment': {
    secretEnv: 'PHYND_CRM_EVENTS_SECRET',
    mode: 'inbound',
  },
  ceq: {
    secretEnv: 'CEQ_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  coforma: {
    secretEnv: 'COFORMA_WEBHOOK_SECRET',
    mode: 'inbound',
  },
  'engagement-event': {
    secretEnv: 'PHYND_ENGAGEMENT_EVENTS_SECRET',
    mode: 'inbound',
  },
  'engagement-artifact': {
    secretEnv: 'PHYND_ENGAGEMENT_EVENTS_SECRET',
    mode: 'inbound',
  },
  'karafiel-grant-award': {
    mode: 'outbound',
    note: 'Manual step: award a staging grant application and verify Karafiel staging receives a non-production callback.',
    requiresManual: true,
  },
  'karafiel-compliance': {
    mode: 'outbound',
    note: 'Manual step: execute staged compliance read path for a staging grant and verify production is untouched.',
    requiresManual: true,
  },
  'cotiza-engagement-projection': {
    mode: 'outbound',
    note: 'Manual step: complete a staging onboarding flow and verify Cotiza staging receives an engagement projection callback.',
    requiresManual: true,
  },
  'dhanam-referral-reward': {
    mode: 'outbound',
    note: 'Manual step: trigger staged Dhanam referral reward and verify only staging receives reward callback.',
    requiresManual: true,
  },
}

const batches = {
  A: ['cotiza', 'forj', 'janua-telemetry'],
  B: ['janua', 'tezca-interest', 'tezca-newsletter', 'ceq'],
  C: [
    'dhanam',
    'fortuna',
    'pravara',
    'karafiel',
    'routecraft',
    'legacy-payment',
    'coforma',
    'engagement-event',
    'engagement-artifact',
  ],
  D: ['karafiel-grant-award', 'karafiel-compliance', 'cotiza-engagement-projection', 'dhanam-referral-reward'],
}

function usage(message) {
  if (message) console.error(`ERROR: ${message}`)
  console.error(`
Usage:
  node scripts/pp5-webhook-batch-probe.mjs <batch-or-lane> [--base-url URL] [--email EMAIL] [--engagement-id ID] [--run-id ID] [--parallelism N] [--dry-run] [--json]

Batches:
  A  - Low mutation inbound
  B  - Contact/lead mutation inbound
  C  - Financial/project mutation inbound
  D  - Outbound integration handoff checks (manual)
  all - All lanes in batches A/B/C/D

Examples:
  node scripts/pp5-webhook-batch-probe.mjs A --base-url https://staging-phynd.app
  node scripts/pp5-webhook-batch-probe.mjs all --parallelism 5 --run-id $(date -u +%Y%m%d%H%M%S)
`)
  process.exit(message ? 1 : 0)
}

function parseArgs(argv) {
  if (argv.length === 0) usage('Missing batch or lane argument')

  const opts = {
    target: argv[0],
    baseUrl: DEFAULT_BASE_URL,
    email: DEFAULT_EMAIL,
    runId: DEFAULT_RUN_ID,
    json: false,
    parallelism: DEFAULT_PARALLELISM,
    engagementId: undefined,
    dryRun: false,
  }

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = argv[i + 1]

    if (!arg.startsWith('--')) usage(`Unknown argument: ${arg}`)

    if (arg === '--base-url') {
      if (!value) usage('Missing value for --base-url')
      opts.baseUrl = value.replace(/\/$/, '')
      i += 1
      continue
    }

    if (arg === '--email') {
      if (!value) usage('Missing value for --email')
      opts.email = value
      i += 1
      continue
    }

    if (arg === '--run-id') {
      if (!value) usage('Missing value for --run-id')
      opts.runId = value
      i += 1
      continue
    }

    if (arg === '--engagement-id') {
      if (!value) usage('Missing value for --engagement-id')
      opts.engagementId = value
      i += 1
      continue
    }

    if (arg === '--parallelism') {
      if (!value || Number.isNaN(Number(value)) || Number(value) < 1) usage('Invalid --parallelism')
      opts.parallelism = Number(value)
      i += 1
      continue
    }

    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }

    if (arg === '--json') {
      opts.json = true
      continue
    }

    usage(`Unknown option: ${arg}`)
  }

  const target = opts.target.toLowerCase()
  const selected = []
  if (target === 'a') selected.push(...batches.A)
  else if (target === 'b') selected.push(...batches.B)
  else if (target === 'c') selected.push(...batches.C)
  else if (target === 'd') selected.push(...batches.D)
  else if (target === 'all') selected.push(...batches.A, ...batches.B, ...batches.C, ...batches.D)
  else if (laneDefinitions[target]) selected.push(target)
  else usage(`Unknown batch/lane: ${opts.target}`)

  const seen = new Set()
  opts.lanes = selected.filter((lane) => (seen.has(lane) ? false : (seen.add(lane), true)))
  return opts
}

function runCommand(args, env) {
  return new Promise((resolve) => {
    const child = spawn('node', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      err += chunk
    })
    child.on('close', (code) => {
      resolve({ code, out: out.trim(), err: err.trim() })
    })
  })
}

function parseStatusLine(output) {
  const match = output.match(/^HTTP\s+(\d{3})/m)
  return match ? Number(match[1]) : null
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function commandAsString(args, envName, envValue) {
  const envExpr = `${envName}=${envValue}`
  return [envExpr, 'node', ...args.map((arg) => shellQuote(arg))].join(' ')
}

function maskedCommandForLane(lane, opts, runType) {
  const secretEnv = laneDefinitions[lane]?.secretEnv
  if (!secretEnv) return null
  const value = runType === 'valid' ? `$${secretEnv}` : INVALID_SECRET
  return commandAsString(commandForLane('send', lane, opts), secretEnv, value)
}

function isManualLane(lane) {
  return laneDefinitions[lane]?.requiresManual === true
}

function manualLaneResult(lane) {
  return {
    lane,
    runType: 'manual',
    passed: null,
    skipped: true,
    status: null,
    reason: laneDefinitions[lane]?.note || 'Manual verification required',
    detail: laneDefinitions[lane]?.note || 'Manual verification required',
    command: 'manual',
  }
}

function commandForLane(action, lane, opts) {
  const args = [
    'scripts/pp5-webhook-probe.mjs',
    action,
    lane,
    '--base-url',
    opts.baseUrl,
    '--email',
    opts.email,
    '--run-id',
    opts.runId,
  ]

  if (opts.engagementId) {
    args.push('--engagement-id', opts.engagementId)
  }

  return args
}

async function probeLane(lane, opts, runType, secret, expectStatus) {
  const requiresEngagementId = lane.startsWith('engagement-')
  const engagementMissing = requiresEngagementId && !opts.engagementId
  const secretEnv = laneDefinitions[lane]?.secretEnv

  if (runType === 'valid' && !secret) {
    return {
      lane,
      runType,
      passed: false,
      skipped: true,
      status: null,
      reason: `${secretEnv} missing`,
    }
  }

  if (engagementMissing) {
    return {
      lane,
      runType,
      passed: false,
      skipped: true,
      status: null,
      reason: '--engagement-id required',
    }
  }

  const command = commandForLane('send', lane, opts)
  if (opts.dryRun) {
    return {
      lane,
      runType,
      passed: null,
      status: null,
      command: maskedCommandForLane(lane, opts, runType),
      reason: 'dry-run',
    }
  }

  const child = await runCommand(
    command,
    {
      ...process.env,
      [secretEnv]: secret,
    },
  )

  const status = parseStatusLine(child.out || child.err)
  const passed = status !== null && expectStatus.includes(status)
  const detail = child.out || child.err || `exit ${child.code}`
  const commandTemplate = maskedCommandForLane(lane, opts, runType)
  if (passed) {
    return { lane, runType, passed: true, status, detail, command: commandTemplate }
  }

  return { lane, runType, passed: false, status, detail, command: commandTemplate }
}

async function runWithConcurrency(items, limit, fn) {
  const results = []
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      results.push(await fn(item))
    }
  }

  const workers = []
  const workerCount = Math.min(limit, items.length)
  for (let i = 0; i < workerCount; i += 1) workers.push(worker())
  await Promise.all(workers)
  return results
}

function printResult(result) {
  const status = result.passed === true ? 'PASS' : result.passed === false ? 'FAIL' : 'SKIP'
  const code = result.status === null ? 'n/a' : String(result.status)
  const details = result.reason ? ` (${result.reason})` : ''
  console.log(`[${status}] ${result.lane} ${result.runType} -> ${code} ${details}`)
}

async function main() {
  const opts = applyStagingWebhookDefaults(parseArgs(process.argv.slice(2)))

  const work = []
  for (const lane of opts.lanes) {
    if (isManualLane(lane)) {
      work.push({
        lane,
        type: 'manual',
        result: manualLaneResult(lane),
      })
      continue
    }

    const secretEnv = laneDefinitions[lane]?.secretEnv
    const secret = process.env[secretEnv]

    work.push({
      lane,
      type: 'probe',
      runType: 'valid',
      secret,
      expectStatus: [200],
    })
    work.push({
      lane,
      type: 'probe',
      runType: 'invalid',
      secret: INVALID_SECRET,
      expectStatus: [401, 403],
    })
  }

  const results = await runWithConcurrency(work, opts.parallelism, (item) =>
    item.type === 'manual'
      ? Promise.resolve(item.result)
      : probeLane(item.lane, opts, item.runType, item.secret, item.expectStatus),
  )

  let failed = 0
  const grouped = new Map()

  for (const result of results) {
    if (!opts.dryRun && !opts.json) {
      printResult(result)
    }
    if (result.passed === false && !result.skipped) failed += 1

    const key = result.lane
    const item = grouped.get(key) ?? { lane: key, valid: null, invalid: null }
    if (result.runType === 'manual') {
      item.valid = result
      item.invalid = result
    } else if (result.runType === 'valid') {
      item.valid = result
    } else {
      item.invalid = result
    }
    grouped.set(key, item)
  }

  if (opts.dryRun && !opts.json) {
    console.log()
    console.log('PP.5 webhook batch dry-run commands:')
    for (const item of grouped.values()) {
      const laneDef = laneDefinitions[item.lane]
      const secretEnv = laneDef?.secretEnv
      const requiresEngagementId = item.lane.startsWith('engagement-')

      if (laneDef?.requiresManual) {
        console.log(`# ${item.lane}`)
        console.log(`- manual: ${laneDef.note}`)
        continue
      }

      if (requiresEngagementId && !opts.engagementId) {
        console.log(`# ${item.lane}`)
        console.log('  NOTE: --engagement-id is required for this lane')
        continue
      }

      const missingSecret = item.valid && item.valid.reason === `${secretEnv} missing`
      const validCommand = item.valid?.command || `${secretEnv}=$${secretEnv} node ...`
      const invalidCommand = item.invalid?.command || `${secretEnv}=${INVALID_SECRET} node ...`

      console.log(`# ${item.lane}`)
      console.log(`- valid:   ${validCommand || 'manual path required'}`)
      console.log(`- invalid: ${invalidCommand || 'manual path required'}`)
      if (missingSecret) {
        console.log('  NOTE: export valid secret before running the valid command')
      }
    }
    console.log('Done')
    return
  }

  if (opts.json) {
    const groupedArray = Array.from(grouped.values())
    const summary = {
      ok: failed === 0,
      failedChecks: failed,
      target: opts.target,
      lanes: opts.lanes,
      parallelism: opts.parallelism,
      runId: opts.runId,
      baseUrl: opts.baseUrl,
      email: opts.email,
      engagementId: opts.engagementId,
      checks: results,
      grouped: groupedArray,
      startedAt: new Date().toISOString(),
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`)
    if (failed > 0) process.exit(1)
    return
  }

  if (failed > 0) {
    console.error(`Batch probe failed: ${failed} failing checks`)
    process.exit(1)
  }

  console.log(`Batch probe pass: ${results.length} checks`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

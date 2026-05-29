#!/usr/bin/env node
/**
 * Operator checklist for crm.madfam.io / staging pilot go-live.
 *
 * Runs automated repo gates, optional live smoke, and prints manual Enclii steps.
 *
 * Usage:
 *   node scripts/pp5-pilot-ops-checklist.mjs
 *   node scripts/pp5-pilot-ops-checklist.mjs --live
 *   CRM_BASE_URL=https://staging-phynd.app node scripts/pp5-pilot-ops-checklist.mjs --live --with-selva-agent
 *   node scripts/pp5-pilot-ops-checklist.mjs --json
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MANUAL_STEPS = [
  {
    id: 'argocd-sync',
    text: 'ArgoCD sync healthy for phynd-crm-staging (web + worker digests current)',
  },
  {
    id: 'staging-secrets',
    text: 'Apply staging secrets: node scripts/pp5-validate-staging-env.mjs <env-file>',
  },
  {
    id: 'db-migrate',
    text: 'Apply migrations: DATABASE_URL=<staging> pnpm db:migrate:tier',
  },
  {
    id: 'webhook-registration',
    text: 'Register provider webhooks (Selva, Tulana, Fortuna, Janua Telemetry, RouteCraft) to staging URLs',
  },
  {
    id: 'janua-oidc',
    text: 'Janua OIDC redirect URIs + admin@madfam.io claims for crm.madfam.io',
  },
  {
    id: 'enclii-domains',
    text: 'Reconcile Enclii junctions vs .enclii.yml declared domains',
  },
  {
    id: 'staging-ingress',
    text: 'Wire staging-phynd.app tunnel/ingress (PP.5 row 12)',
  },
]

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    live: argv.includes('--live'),
    skipProdAuth: !argv.includes('--with-prod-auth'),
    withSelvaAgent: argv.includes('--with-selva-agent'),
    withProdAuth: argv.includes('--with-prod-auth'),
  }
}

function run(command, args = []) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return { ok: result.status === 0, output, status: result.status ?? 1 }
}

export function buildPilotOpsReport(options, env = process.env) {
  const automated = []

  const preflight = run('node', [
    'scripts/verify-pilot-go-live.mjs',
    ...(options.skipProdAuth ? ['--skip-prod-auth'] : []),
    '--json',
  ])
  let preflightPayload = null
  try {
    preflightPayload = JSON.parse(preflight.output)
  } catch {
    preflightPayload = { ok: false }
  }
  automated.push({
    id: 'verify-pilot-go-live',
    ok: preflight.ok && preflightPayload.ok === true,
    status: preflight.status,
  })

  const migrateCheck = run('node', ['scripts/run-tier-migrate.mjs', '--check-only'])
  automated.push({
    id: 'db-migrate-artifacts',
    ok: migrateCheck.ok,
    status: migrateCheck.status,
  })

  if (options.live) {
    const baseUrl = env.CRM_BASE_URL?.trim()
    if (!baseUrl) {
      automated.push({
        id: 'verify-post-deploy',
        ok: false,
        status: 1,
        error: 'CRM_BASE_URL is required for --live',
      })
    } else {
      const postDeployArgs = ['scripts/verify-post-deploy.mjs', '--retries', '3', '--retry-delay-ms', '5000']
      if (options.withProdAuth) postDeployArgs.push('--with-prod-auth')
      if (options.withSelvaAgent) postDeployArgs.push('--with-selva-agent')
      const postDeploy = run('node', postDeployArgs)
      automated.push({
        id: 'verify-post-deploy',
        ok: postDeploy.ok,
        status: postDeploy.status,
        baseUrl,
      })
    }
  }

  const failedAutomated = automated.filter((step) => !step.ok).length

  return {
    ok: failedAutomated === 0,
    failedAutomated,
    automated,
    manual: MANUAL_STEPS,
    runbook: 'docs/runbooks/PILOT_GO_LIVE.md',
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildPilotOpsReport(options)

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('Phynd CRM pilot ops checklist')
    console.log('')
    for (const step of report.automated) {
      console.log(step.ok ? `PASS ${step.id}` : `FAIL ${step.id}`)
      if (step.error) console.log(`  ${step.error}`)
      if (step.baseUrl) console.log(`  baseUrl: ${step.baseUrl}`)
    }
    console.log('')
    console.log('Manual steps (Enclii / provider ops):')
    for (const step of report.manual) {
      console.log(`  [ ] ${step.text}`)
    }
    console.log('')
    console.log(`Runbook: ${report.runbook}`)
    if (!options.live) {
      console.log('Live smoke: CRM_BASE_URL=<tier> node scripts/pp5-pilot-ops-checklist.mjs --live')
    }
  }

  if (!report.ok) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}

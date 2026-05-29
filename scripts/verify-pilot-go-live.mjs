#!/usr/bin/env node
/**
 * Pre-flight bundle for crm.madfam.io / Selva pilot go-live.
 *
 * Usage:
 *   node scripts/verify-pilot-go-live.mjs
 *   node scripts/verify-pilot-go-live.mjs --json
 *   node scripts/verify-pilot-go-live.mjs --skip-prod-auth
 */

import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    skipProdAuth: argv.includes('--skip-prod-auth'),
  }
}

function run(command, args = []) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return { ok: result.status === 0, output, status: result.status ?? 1 }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const checks = [
    { name: 'pp5-stability', run: () => run('pnpm', ['pp5:stability']) },
    { name: 'verify-migrations', run: () => run('pnpm', ['verify:migrations']) },
    { name: 'pp5-staging-audit', run: () => run('node', ['scripts/pp5-staging-audit.mjs']) },
    {
      name: 'verify-pilot-readiness',
      run: () =>
        run('node', [
          'scripts/verify-pilot-readiness.mjs',
          ...(options.skipProdAuth ? ['--skip-prod-auth'] : []),
        ]),
    },
    { name: 'verify-post-deploy-dry-run', run: () => run('node', ['scripts/verify-post-deploy.mjs', '--dry-run']) },
  ]

  const results = []
  let failed = 0

  for (const check of checks) {
    const result = check.run()
    results.push({ name: check.name, ...result })
    if (!result.ok) failed += 1
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ok: failed === 0,
          failedChecks: failed,
          checks: results.map(({ name, ok, status }) => ({ name, ok, status })),
        },
        null,
        2,
      ),
    )
  } else {
    for (const result of results) {
      if (result.ok) {
        console.log(`PASS ${result.name}`)
      } else {
        console.error(`FAIL ${result.name}`)
        if (result.output) {
          for (const line of result.output.split('\n').slice(0, 8)) {
            console.error(`  ${line}`)
          }
        }
      }
    }
    console.log('')
    console.log(failed === 0 ? 'Pilot go-live pre-flight: PASS' : `Pilot go-live pre-flight: FAIL (${failed})`)
    console.log('Ops runbook: docs/runbooks/PILOT_GO_LIVE.md')
    if (failed === 0) {
      console.log('After deploy: CRM_BASE_URL=<tier> pnpm verify:post-deploy')
    }
  }

  if (failed > 0) process.exit(1)
}

main()

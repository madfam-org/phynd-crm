#!/usr/bin/env node
/**
 * Bundle verification for client lifecycle remediation (code + optional live env).
 *
 * Usage:
 *   node scripts/verify-client-lifecycle.mjs
 *   node scripts/verify-client-lifecycle.mjs --skip-env
 *   CRM_BASE_URL=https://phynd.app node scripts/verify-client-lifecycle.mjs --live
 */

import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  return {
    skipEnv: argv.includes('--skip-env'),
    live: argv.includes('--live'),
    json: argv.includes('--json'),
  }
}

function run(command, args = []) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    status: result.status ?? 1,
  }
}

function main() {
  const options = parseArgs(process.argv)
  const checks = [
    {
      name: 'services-lifecycle-tests',
      run: () =>
        run('pnpm', [
          '--filter',
          '@phynd/services',
          'test',
          '--',
          'publish-quote-to-portal.service.test.ts',
          'engagement-recovery.service.test.ts',
          'engagement-portal-signoff.service.test.ts',
          'engagement-portal-magic-link.service.test.ts',
        ]),
    },
    {
      name: 'web-auth-tests',
      run: () =>
        run('pnpm', [
          '--filter',
          '@phynd/web',
          'exec',
          'vitest',
          'run',
          'src/lib/auth/__tests__/request.test.ts',
          'src/lib/http/__tests__/app-host.test.ts',
        ]),
    },
  ]

  if (!options.skipEnv) {
    checks.unshift({
      name: 'client-lifecycle-env',
      run: () => run('node', ['scripts/verify-client-lifecycle-env.mjs', '--json']),
    })
  }

  if (options.live) {
    const base = process.env.CRM_BASE_URL ?? 'https://phynd.app'
    checks.push({
      name: 'live-health',
      run: () => run('node', ['scripts/client-lifecycle-probe.mjs', 'health', '--base', base]),
    })
  }

  const results = checks.map((check) => ({ name: check.name, ...check.run() }))
  const failed = results.filter((row) => !row.ok).length

  if (options.json) {
    console.log(JSON.stringify({ ok: failed === 0, failed, results }, null, 2))
  } else {
    for (const row of results) {
      console.log(row.ok ? `PASS ${row.name}` : `FAIL ${row.name}`)
      if (!row.ok && row.output) {
        for (const line of row.output.split('\n').slice(0, 8)) console.log(`  ${line}`)
      }
    }
    console.log('')
    console.log(failed === 0 ? 'Client lifecycle verification: PASS' : `Client lifecycle verification: FAIL (${failed})`)
  }

  process.exit(failed === 0 ? 0 : 1)
}

main()

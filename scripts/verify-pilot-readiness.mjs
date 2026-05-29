#!/usr/bin/env node
/**
 * Pre-pilot readiness bundle (code + prod auth URLs + migration artifacts).
 *
 * Usage:
 *   node scripts/verify-pilot-readiness.mjs
 *   node scripts/verify-pilot-readiness.mjs --skip-prod-auth
 */

import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  return {
    skipProdAuth: argv.includes('--skip-prod-auth'),
    skipSelvaAgent: argv.includes('--skip-selva-agent'),
  }
}

function runNode(script, args = []) {
  const result = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return { ok: result.status === 0, output, status: result.status ?? 1 }
}

function runPnpm(script) {
  const result = spawnSync('pnpm', [script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return { ok: result.status === 0, output, status: result.status ?? 1 }
}

function main() {
  const options = parseArgs(process.argv)
  const checks = [
    { name: 'verify-migrations', run: () => runNode('scripts/verify-migrations.mjs') },
    {
      name: 'pp5-webhook-lanes',
      run: () => {
        const result = runNode('scripts/pp5-webhook-probe.mjs', ['list'])
        const required = ['selva', 'tulana-import', 'tulana-send', 'janua-telemetry-identify', 'fortuna']
        const missing = required.filter((lane) => !result.output.includes(lane))
        return {
          ok: result.ok && missing.length === 0,
          output:
            missing.length > 0
              ? `Missing lanes: ${missing.join(', ')}\n${result.output}`
              : result.output,
          status: missing.length > 0 ? 1 : result.status,
        }
      },
    },
  ]

  if (!options.skipProdAuth) {
    checks.unshift({ name: 'verify-prod-auth', run: () => runPnpm('verify:prod-auth') })
  }

  if (!options.skipSelvaAgent) {
    checks.push({
      name: 'verify-selva-agent',
      run: () => {
        const token = process.env.FEDERATION_API_TOKEN?.trim()
        const args = token ? ['--json'] : ['--dry-run', '--json']
        const result = runNode('scripts/verify-selva-agent-integration.mjs', args)
        if (!result.ok) {
          return result
        }
        try {
          const payload = JSON.parse(result.output)
          return { ok: payload.ok === true, output: result.output, status: payload.ok ? 0 : 1 }
        } catch {
          return { ok: false, output: result.output, status: 1 }
        }
      },
    })
  }

  let failed = 0
  for (const check of checks) {
    const result = check.run()
    if (result.ok) {
      console.log(`PASS ${check.name}`)
      continue
    }
    failed += 1
    console.error(`FAIL ${check.name}`)
    if (result.output) {
      for (const line of result.output.split('\n').slice(0, 12)) {
        console.error(`  ${line}`)
      }
    }
  }

  if (failed > 0) {
    console.error(`\nPilot readiness: FAIL (${failed} check(s))`)
    process.exit(1)
  }

  console.log('\nPilot readiness: PASS')
}

main()

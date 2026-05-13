#!/usr/bin/env node

import { spawn } from 'node:child_process'
import process from 'node:process'

const USAGE = `Usage:
  node scripts/pp5-readiness.mjs [--include-wave0] [--json]

Options:
  --include-wave0   include node scripts/pp5-wave0-check.mjs (requires
                    kubectl access)
  --json            emit machine-readable JSON result summary
`

function parseArgs(argv) {
  const options = {
    includeWave0: false,
    outputJson: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--include-wave0') {
      options.includeWave0 = true
      continue
    }
    if (arg === '--json') {
      options.outputJson = true
      continue
    }
    console.error(`Unknown argument: ${arg}`)
    console.error(USAGE)
    process.exit(1)
  }

  return options
}

const STATIC_CHECKS = [
  {
    name: 'pp5:stability',
    command: ['pnpm', 'pp5:stability'],
    description: 'cross-surface env split + webhook secret guardrails',
  },
  {
    name: 'pp5:test:pp5',
    command: ['pnpm', 'test:pp5'],
    description: 'pp5 webhook batch script regression suite',
  },
  {
    name: 'ci:verify-gates',
    command: ['pnpm', 'ci:verify-gates'],
    description: 'CI wiring + e2e workflow contract',
  },
  {
    name: 'pp5:branch-protection-check',
    command: ['pnpm', 'pp5:branch-protection-check'],
    description: 'branch protection required checks match CI job names',
  },
]

const WAVE0_CHECK = [
  {
    name: 'pp5:wave0-check',
    command: ['node', 'scripts/pp5-wave0-check.mjs'],
    description: 'staging rollout surface checks (namespace, ArgoCD, rollouts, health)',
  },
]

function runCommand(definition) {
  const { name, command, description } = definition
  const [commandName, ...args] = command
  const startedAt = Date.now()

  return new Promise((resolve) => {
    const child = spawn(commandName, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      resolve({
        name,
        description,
        command: `${commandName} ${args.join(' ')}`.trim(),
        ok: false,
        status: 1,
        stdout: '',
        stderr: String(error.message || error),
        elapsedMs: Date.now() - startedAt,
      })
    })

    child.on('close', (code) => {
      resolve({
        name,
        description,
        command: `${commandName} ${args.join(' ')}`.trim(),
        ok: code === 0,
        status: code ?? 1,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        elapsedMs: Date.now() - startedAt,
      })
    })
  })
}

async function runChecks(checks) {
  const parallel = Promise.all(checks.map((check) => runCommand(check)))
  return parallel
}

function summarize(results, includeWave0) {
  let failed = 0

  const lines = [
    '# PP.5 readiness run',
    `kicker: ${includeWave0 ? 'static + wave0 checks' : 'static checks'}`,
    `started: ${new Date().toISOString()}`,
    '',
  ]

  for (const result of results) {
    if (result.ok) {
      lines.push(`PASS ${result.name}`)
      continue
    }

    failed += 1
    lines.push(`FAIL ${result.name} (status ${result.status})`)
    lines.push(`  cmd: ${result.command}`)
    lines.push(`  elapsed_ms: ${result.elapsedMs}`)
    const detail = (result.stderr || result.stdout || '').trim()
    if (detail) {
      for (const line of detail.split('\n').slice(0, 8)) {
        lines.push(`  ${line}`)
      }
    }
  }

  lines.push('')
  lines.push(`result: ${failed === 0 ? 'PASS' : 'FAIL'}`)
  lines.push(`failed_checks: ${failed}`)
  lines.push(`total_checks: ${results.length}`)
  if (!includeWave0) {
    lines.push('next: add --include-wave0 to validate kubectl/ArgoCD rollout readiness')
  }

  return { failed, output: lines.join('\n'), results }
}

function usageError(message) {
  if (message) {
    console.error(`Error: ${message}`)
  }
  console.error(USAGE)
  process.exit(1)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const checks = [...STATIC_CHECKS]

  if (options.includeWave0) checks.push(...WAVE0_CHECK)

  const results = []
  const runStatic = runChecks(checks)
  const ordered = await runStatic
  results.push(...ordered)

  const summary = summarize(results, options.includeWave0)
  if (options.outputJson) {
    console.log(JSON.stringify({
      startedAt: new Date().toISOString(),
      includeWave0: options.includeWave0,
      failedChecks: summary.failed,
      totalChecks: results.length,
      checks: results.map((result) => ({
        name: result.name,
        description: result.description,
        command: result.command,
        ok: result.ok,
        status: result.status,
        elapsedMs: result.elapsedMs,
      })),
    }, null, 2))
    if (summary.failed > 0) process.exit(1)
    return
  }

  console.log(summary.output)
  if (summary.failed > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  usageError(error instanceof Error ? error.message : String(error))
})

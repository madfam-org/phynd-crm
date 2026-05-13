#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import process from 'node:process'

function usage(message) {
  if (message) console.error(`ERROR: ${message}`)
  console.error(`
Usage:
  node scripts/pp5-staging-reset.mjs [--database-url URL] [--allowlist-domains d1,d2]
  node scripts/pp5-staging-reset.mjs --skip-seed --database-url URL
  DATABASE_URL=postgresql://... node scripts/pp5-staging-reset.mjs

This helper implements the PP.5 deferred baseline option:
- reseed staging DB with deterministic safe fixtures
- run PP.5 staging data safety check

Options:
  --database-url URL          Database URL (defaults to DATABASE_URL env)
  --allowlist-domains d1,d2   EMAIL_ALLOWLIST_DOMAINS override (default: staging.madfam.io,madfam.io)
  --sample-limit N            PP.5 safety query sample limit (default: 5)
  --skip-seed                 Skip db:seed step
  --skip-safety               Skip PP.5 staging data safety step
  --dry-run                   Show planned commands only
`)
  process.exit(message ? 1 : 0)
}

function parseArgs(argv) {
  const opts = {
    databaseUrl: process.env.DATABASE_URL,
    allowlistDomains: 'staging.madfam.io,madfam.io',
    sampleLimit: 5,
    skipSeed: false,
    skipSafety: false,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (!arg.startsWith('--')) usage(`Unknown positional arg: ${arg}`)

    if (arg === '--database-url') {
      if (!next) usage('Missing value for --database-url')
      opts.databaseUrl = next
      i += 1
      continue
    }

    if (arg === '--allowlist-domains') {
      if (!next) usage('Missing value for --allowlist-domains')
      opts.allowlistDomains = next
      i += 1
      continue
    }

    if (arg === '--sample-limit') {
      if (!next || Number.isNaN(Number(next)) || Number(next) < 1) usage('Invalid --sample-limit')
      opts.sampleLimit = Number(next)
      i += 1
      continue
    }

    if (arg === '--skip-seed') {
      opts.skipSeed = true
      continue
    }

    if (arg === '--skip-safety') {
      opts.skipSafety = true
      continue
    }

    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }

    usage(`Unknown option: ${arg}`)
  }

  if (!opts.databaseUrl) usage('Missing --database-url and DATABASE_URL env var')
  if (!opts.databaseUrl.includes('phynd_crm_staging')) {
    usage('DATABASE_URL must target phynd_crm_staging for staging reset')
  }

  return opts
}

function runCommand(command, args, env) {
  if (env.dryRun) {
    const commandLine = [command, ...args].join(' ')
    console.log(`DRY RUN: ${commandLine}`)
    return 0
  }

  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`)
  }

  return result.status
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const start = new Date().toISOString()
  console.log(`PP.5 staging reset start: ${start}`)
  console.log(`Database: ${opts.databaseUrl}`)

  const commandEnv = {
    ...process.env,
    DATABASE_URL: opts.databaseUrl,
    NODE_ENV: process.env.NODE_ENV || 'development',
    TENANT_ID: 'madfam',
  }

  if (!opts.skipSeed) {
    const seedCode = runCommand('pnpm', ['db:seed'], {
      ...commandEnv,
      PP5_STAGING_RESET: '1',
    })
    if (seedCode !== 0) process.exit(1)
  }

  if (!opts.skipSafety) {
    const safetyArgs = [
      'scripts/pp5-staging-data-safety.mjs',
      '--database-url',
      opts.databaseUrl,
      '--allowlist-domains',
      opts.allowlistDomains,
      '--sample-limit',
      String(opts.sampleLimit),
    ]
    const safetyCode = runCommand('node', safetyArgs, {
      ...commandEnv,
      PP5_STAGING_RESET: '1',
    })
    if (safetyCode !== 0) process.exit(1)
  }

  const end = new Date().toISOString()
  console.log(`PP.5 staging reset completed: ${end}`)
}

main()

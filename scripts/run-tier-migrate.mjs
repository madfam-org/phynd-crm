#!/usr/bin/env node
/**
 * Apply Drizzle migrations for a deployment tier (staging/prod).
 *
 * Enclii-first: run against the tier database from a trusted operator shell or
 * break-glass job — never commit DATABASE_URL values.
 *
 * Usage:
 *   node scripts/run-tier-migrate.mjs --check-only
 *   DATABASE_URL=postgresql://... node scripts/run-tier-migrate.mjs
 *   DATABASE_URL=postgresql://... node scripts/run-tier-migrate.mjs --tier staging
 */

import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  const options = { checkOnly: false, tier: process.env.PHYND_DEPLOYMENT_TIER ?? '' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      continue
    }
    if (arg === '--check-only') {
      options.checkOnly = true
      continue
    }
    if (arg === '--tier') {
      options.tier = argv[++i] ?? ''
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    env: process.env,
  })
  return result.status ?? 1
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const verifyStatus = run('node', ['scripts/verify-migrations.mjs'])
  if (verifyStatus !== 0) {
    process.exit(verifyStatus)
  }

  if (options.checkOnly) {
    console.log('PASS run-tier-migrate --check-only (migration artifacts present)')
    console.log('Next: DATABASE_URL=<tier-url> node scripts/run-tier-migrate.mjs')
    return
  }

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    console.error('BLOCKED: DATABASE_URL is required to apply migrations')
    console.error('Use --check-only to validate migration artifacts only')
    process.exit(1)
  }

  if (options.tier === 'staging' && !databaseUrl.includes('phynd_crm_staging')) {
    console.error('BLOCKED: staging tier requires DATABASE_URL targeting phynd_crm_staging')
    process.exit(1)
  }

  const migrateStatus = run('pnpm', ['db:migrate'])
  if (migrateStatus !== 0) {
    process.exit(migrateStatus)
  }

  console.log(`PASS run-tier-migrate applied migrations${options.tier ? ` (${options.tier})` : ''}`)
}

main()

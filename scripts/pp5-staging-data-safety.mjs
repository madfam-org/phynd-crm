#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const DEFAULT_ALLOWLIST = 'staging.madfam.io,madfam.io'
const DEFAULT_SAMPLE_LIMIT = 5

function usage(message) {
  if (message) console.error(`ERROR: ${message}`)
  console.error(`
Usage:
  node scripts/pp5-staging-data-safety.mjs [--database-url URL] [--allowlist-domains d1,d2]
  DATABASE_URL=https://... node scripts/pp5-staging-data-safety.mjs

This script exits non-zero when PII-like values are found in staging data.
It requires "psql" in PATH.
`)
  process.exit(message ? 1 : 0)
}

function parseArgs(argv) {
  const opts = {
    databaseUrl: process.env.DATABASE_URL,
    allowlistDomains: process.env.EMAIL_ALLOWLIST_DOMAINS || DEFAULT_ALLOWLIST,
    sampleLimit: DEFAULT_SAMPLE_LIMIT,
    ignoreSamples: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = argv[i + 1]

    if (!arg.startsWith('--')) {
      usage(`Unknown positional arg: ${arg}`)
    }

    if (arg === '--database-url') {
      if (!value) usage('Missing value for --database-url')
      opts.databaseUrl = value
      i += 1
      continue
    }

    if (arg === '--allowlist-domains') {
      if (!value) usage('Missing value for --allowlist-domains')
      opts.allowlistDomains = value
      i += 1
      continue
    }

    if (arg === '--sample-limit') {
      if (!value || Number.isNaN(Number(value)) || Number(value) < 1) usage('Invalid --sample-limit')
      opts.sampleLimit = Number(value)
      i += 1
      continue
    }

    if (arg === '--no-samples') {
      opts.ignoreSamples = true
      continue
    }

    usage(`Unknown option: ${arg}`)
  }

  if (!opts.databaseUrl) usage('Missing --database-url and DATABASE_URL env')
  return opts
}

function ensureTools() {
  const result = spawnSync('psql', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) {
    console.error('ERROR: "psql" is required to run this check')
    process.exit(1)
  }
}

function runQuery(databaseUrl, query) {
  const result = spawnSync(
    'psql',
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '|', '-c', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `psql failed for query: ${query}`)
    throw new Error(`psql failed: ${result.status}`)
  }

  return (result.stdout || '')
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
}

function escapeSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function parseCount(rows, queryName) {
  if (rows.length === 0) throw new Error(`No output for query ${queryName}`)
  const value = Number.parseInt(rows[0], 10)
  if (Number.isNaN(value)) throw new Error(`Invalid count output for ${queryName}: ${rows[0]}`)
  return value
}

function runCheck(databaseUrl, check, showSamples) {
  const countRows = runQuery(databaseUrl, check.countQuery)
  const count = parseCount(countRows, check.name)
  const result = { name: check.name, count, samples: [] }

  if (!showSamples || count === 0) return result

  const sampleRows = runQuery(databaseUrl, check.sampleQuery)
  result.samples = sampleRows.slice(0, 10)
  return result
}

function summarizeCheck(checkResult) {
  if (checkResult.count === 0) {
    console.log(`PASS ${checkResult.name}`)
    return true
  }

  console.error(`FAIL ${checkResult.name}: ${checkResult.count} suspicious record(s)`)
  for (const sample of checkResult.samples) {
    console.error(`  sample: ${sample}`)
  }
  return false
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const allowlistDomains = opts.allowlistDomains
    .split(',')
    .map((entry) => entry.trim())
    .map((entry) => entry.toLowerCase())
    .filter(Boolean)

  if (allowlistDomains.length === 0) usage('No allowlist domains provided')

  ensureTools()

  const allowlistSql = allowlistDomains.map(escapeSqlLiteral).join(',')
  const checks = [
    {
      name: 'contacts with non-staging email domain',
      countQuery: `
        SELECT COUNT(*)::bigint
        FROM contacts
        WHERE deleted_at IS NULL
          AND email IS NOT NULL
          AND (
            split_part(lower(email), '@', 2) NOT IN (${allowlistSql})
            OR split_part(lower(email), '@', 2) IS NULL
          )
      `,
      sampleQuery: `
        SELECT id || ':' || COALESCE(email, '')
        FROM contacts
        WHERE deleted_at IS NULL
          AND email IS NOT NULL
          AND (
            split_part(lower(email), '@', 2) NOT IN (${allowlistSql})
            OR split_part(lower(email), '@', 2) IS NULL
          )
        ORDER BY created_at DESC
        LIMIT ${opts.sampleLimit}
      `,
    },
    {
      name: 'contacts with unmasked phone numbers',
      countQuery: `
        SELECT COUNT(*)::bigint
        FROM contacts
        WHERE deleted_at IS NULL
          AND phone IS NOT NULL
          AND length(regexp_replace(phone, '\\D', '', 'g')) BETWEEN 7 AND 20
          AND phone !~* '(redacted|masked|stub|sample|test|demo|\\*{2,})'
      `,
      sampleQuery: `
        SELECT id || ':' || COALESCE(phone, '')
        FROM contacts
        WHERE deleted_at IS NULL
          AND phone IS NOT NULL
          AND length(regexp_replace(phone, '\\D', '', 'g')) BETWEEN 7 AND 20
          AND phone !~* '(redacted|masked|stub|sample|test|demo|\\*{2,})'
        ORDER BY created_at DESC
        LIMIT ${opts.sampleLimit}
      `,
    },
    {
      name: 'notes with embedded email-like values',
      countQuery: `
        SELECT COUNT(*)::bigint
        FROM notes
        WHERE content ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
      `,
      sampleQuery: `
        SELECT id || ':' || left(content, 160)
        FROM notes
        WHERE content ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
        ORDER BY created_at DESC
        LIMIT ${opts.sampleLimit}
      `,
    },
    {
      name: 'webhook payloads with email-like values',
      countQuery: `
        SELECT COUNT(*)::bigint
        FROM webhook_events
        WHERE payload::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
      `,
      sampleQuery: `
        SELECT id || ':' || left(payload::text, 160)
        FROM webhook_events
        WHERE payload::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
        ORDER BY created_at DESC
        LIMIT ${opts.sampleLimit}
      `,
    },
    {
      name: 'visitor session metadata with email-like values',
      countQuery: `
        SELECT COUNT(*)::bigint
        FROM visitor_sessions
        WHERE metadata::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
      `,
      sampleQuery: `
        SELECT id || ':' || left(COALESCE(metadata::text, ''), 160)
        FROM visitor_sessions
        WHERE metadata::text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
        ORDER BY created_at DESC
        LIMIT ${opts.sampleLimit}
      `,
    },
  ]

  let failed = 0
  for (const check of checks) {
    try {
      const result = runCheck(opts.databaseUrl, check, !opts.ignoreSamples)
      if (!summarizeCheck(result)) failed += 1
    } catch (error) {
      console.error(`ERROR running ${check.name}: ${error instanceof Error ? error.message : String(error)}`)
      failed += 1
    }
  }

  if (failed > 0) {
    console.error(`PII safety check failed: ${failed} failing check(s)`)
    process.exit(1)
  }

  console.log('PASS staging data safety checks')
}

main()

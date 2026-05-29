#!/usr/bin/env node
/**
 * Ensures required Drizzle migrations exist before staging/prod pilot.
 *
 * Usage:
 *   node scripts/verify-migrations.mjs
 *   node scripts/verify-migrations.mjs --require 0008_orange_sandman 0009_lazy_wrecker
 */

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_REQUIRED = ['0008_orange_sandman', '0009_lazy_wrecker', '0010_lyrical_shooting_star']
const JOURNAL_PATH = 'packages/db/src/migrations/meta/_journal.json'
const MIGRATIONS_DIR = 'packages/db/src/migrations'

function parseArgs(argv) {
  const required = []
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--require' && argv[i + 1]) {
      required.push(argv[++i])
      continue
    }
    console.error(`Unknown argument: ${argv[i]}`)
    process.exit(1)
  }
  return required.length > 0 ? required : DEFAULT_REQUIRED
}

function main() {
  const requiredTags = parseArgs(process.argv)
  const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), JOURNAL_PATH), 'utf8'))
  const tags = new Set((journal.entries ?? []).map((entry) => entry.tag))

  let failed = 0
  for (const tag of requiredTags) {
    const sqlPath = path.join(process.cwd(), MIGRATIONS_DIR, `${tag}.sql`)
    if (!tags.has(tag)) {
      failed += 1
      console.error(`FAIL missing journal entry: ${tag}`)
      continue
    }
    if (!fs.existsSync(sqlPath)) {
      failed += 1
      console.error(`FAIL missing SQL file: ${sqlPath}`)
      continue
    }
    console.log(`PASS migration ${tag}`)
  }

  if (failed > 0) {
    process.exit(1)
  }
}

main()

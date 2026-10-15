#!/usr/bin/env node
/**
 * Ensures the Drizzle migration ARTIFACTS in this checkout are complete: every
 * journal entry (or each `--require` tag) has its SQL file.
 *
 * This checks the repo, not a database. Whether a deployed database has applied
 * them is `node scripts/db-migrate.mjs` (docs/runbooks/apply-migrations.md).
 *
 * Usage:
 *   node scripts/verify-migrations.mjs
 *   node scripts/verify-migrations.mjs --require 0008_orange_sandman 0009_lazy_wrecker
 */

import fs from 'node:fs'
import path from 'node:path'

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
  return required
}

function main() {
  const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), JOURNAL_PATH), 'utf8'))
  const journalTags = (journal.entries ?? []).map((entry) => entry.tag)
  const tags = new Set(journalTags)
  // Default: every journal entry, so the check never goes stale as migrations land.
  const explicit = parseArgs(process.argv)
  const requiredTags = explicit.length > 0 ? explicit : journalTags

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

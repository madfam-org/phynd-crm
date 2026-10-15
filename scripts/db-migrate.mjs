#!/usr/bin/env node
/**
 * Drizzle migration status and apply for a deployed database (operator + deploy hook).
 *
 * Why this exists: the deployed images carry the migrations (the worker image has
 * `node_modules/@phynd/db/src/migrations`) but not drizzle-kit, and nothing ran them
 * on deploy, so production fell behind the repo. This script needs only the
 * `postgres` driver, so it runs inside the worker image (Argo CD PreSync hook
 * `infra/k8s/production/db-migrate-job.yaml`) or from a checkout.
 *
 * It keeps drizzle's own bookkeeping, so `drizzle-kit migrate` and this script
 * agree: table `drizzle.__drizzle_migrations (id serial, hash text, created_at bigint)`;
 * a journal entry is pending when its `when` is later than the newest
 * `created_at`; each row stores sha256(<file contents>) and the journal `when`.
 *
 * Safety:
 *   - dry-run is the default and runs in a `BEGIN READ ONLY` transaction;
 *   - `--apply` is all-or-nothing: ONE transaction, `pg_advisory_xact_lock` (so a
 *     hook and an operator never run at once), the plan is re-read under the lock,
 *     every pending migration is applied in journal order, then recorded;
 *   - `--apply` refuses (exit 3) when the plan has blockers: an applied migration
 *     whose file changed, an applied row the journal does not know, or schema
 *     drift (a pending migration creates a table, column, index or constraint that
 *     already exists, i.e. it was partly applied by hand);
 *   - `lock_timeout` keeps a migration from queueing live traffic behind it: if a
 *     lock is not granted in time the transaction aborts and nothing is applied.
 *
 * Output: migration tags and counts only; never the database URL.
 *
 * Usage (local / port-forward):
 *   DATABASE_URL=postgresql://... node scripts/db-migrate.mjs [--json]
 *   DATABASE_URL=... node scripts/db-migrate.mjs --apply
 *
 * Usage (in-cluster; see docs/runbooks/apply-migrations.md):
 *   kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
 *     node --input-type=module - < scripts/db-migrate.mjs
 *
 * Options:
 *   --apply                 apply pending migrations (refused when blockers exist)
 *   --fail-on-pending       dry-run exits 4 when anything is pending
 *   --json                  print the machine-readable report only
 *   --migrations-dir <dir>  override the migrations folder
 *   --database-env <NAME>   read the URL from env NAME (e.g. DATABASE_URL_<TENANT>)
 *   --lock-timeout <dur>    Postgres lock_timeout for --apply (default 10s)
 */

import crypto from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const IDENT = /^[a-z_][a-z0-9_]*$/
const DURATION = /^\d+(ms|s|min)$/
const STATEMENT_BREAKPOINT = '--> statement-breakpoint'
/** Advisory-lock key: any stable bigint; shared by every runner of this script. */
export const LOCK_KEY = 7_201_510_001

export const EXIT = { ok: 0, error: 1, usage: 2, blocked: 3, pending: 4 }

export function parseArgs(argv) {
  const args = {
    apply: false,
    json: false,
    failOnPending: false,
    databaseEnv: 'DATABASE_URL',
    migrationsDir: null,
    lockTimeout: '10s',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--json') args.json = true
    else if (a === '--fail-on-pending') args.failOnPending = true
    else if (a === '--database-env') args.databaseEnv = argv[++i] ?? ''
    else if (a === '--migrations-dir') args.migrationsDir = argv[++i] ?? ''
    else if (a === '--lock-timeout') args.lockTimeout = argv[++i] ?? ''
    else if (a === '-') continue
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!IDENT.test(args.databaseEnv.toLowerCase()))
    throw new Error('--database-env must be an env var name')
  if (!DURATION.test(args.lockTimeout)) throw new Error('--lock-timeout must look like 10s')
  if (args.apply && args.failOnPending) throw new Error('--fail-on-pending is a dry-run option')
  return args
}

/**
 * Migrations folder: the worker image keeps `@phynd/db` under node_modules (a pnpm
 * symlink, hence realpath); a checkout keeps it under packages/db.
 */
export function resolveMigrationsDir({ cwd = process.cwd(), scriptUrl = import.meta.url } = {}) {
  const bases = [path.join(cwd, 'node_modules/@phynd/db'), path.join(cwd, 'packages/db')]
  try {
    bases.push(path.join(path.dirname(fileURLToPath(scriptUrl)), '../packages/db'))
  } catch {
    // piped on stdin: no script file to resolve from
  }
  for (const base of bases) {
    try {
      const dir = path.join(realpathSync(base), 'src/migrations')
      if (existsSync(path.join(dir, 'meta/_journal.json'))) return dir
    } catch {
      // try the next location
    }
  }
  throw new Error(
    `cannot find packages/db/src/migrations from ${cwd}; run from the repo root or the worker /app, or pass --migrations-dir`,
  )
}

/** Same rules as scripts/link-janua-users.mjs (inlined: the script is also piped). */
export function resolvePostgresPath({ cwd = process.cwd(), scriptUrl = import.meta.url } = {}) {
  const bases = [path.join(cwd, 'node_modules/@phynd/db'), path.join(cwd, 'packages/db')]
  try {
    bases.push(path.join(path.dirname(fileURLToPath(scriptUrl)), '../packages/db'))
  } catch {
    // piped on stdin
  }
  bases.push(cwd)
  for (const base of bases) {
    try {
      const real = realpathSync(base)
      return createRequire(path.join(real, 'package.json')).resolve('postgres')
    } catch {
      // try the next location
    }
  }
  throw new Error(`cannot resolve the \`postgres\` package from ${cwd}`)
}

/** Reads the journal and files exactly as drizzle's readMigrationFiles() does. */
export function readMigrations(dir) {
  const journal = JSON.parse(readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8'))
  return (journal.entries ?? []).map((entry) => {
    const file = path.join(dir, `${entry.tag}.sql`)
    if (!existsSync(file)) throw new Error(`journal entry ${entry.tag} has no SQL file`)
    const text = readFileSync(file).toString()
    return {
      tag: entry.tag,
      when: Number(entry.when),
      hash: crypto.createHash('sha256').update(text).digest('hex'),
      statements: text.split(STATEMENT_BREAKPOINT).filter((s) => s.trim().length > 0),
    }
  })
}

const OBJECT_PATTERNS = [
  { kind: 'table', re: /CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/g },
  { kind: 'index', re: /CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)"/g },
  { kind: 'column', re: /ALTER TABLE "([^"]+)" ADD COLUMN (?:IF NOT EXISTS )?"([^"]+)"/g },
  { kind: 'constraint', re: /ADD CONSTRAINT "([^"]+)"/g },
]

/** Objects a drizzle-generated migration creates (for the drift check). */
export function createdObjects(statements) {
  const objects = []
  for (const stmt of statements) {
    for (const { kind, re } of OBJECT_PATTERNS) {
      for (const m of stmt.matchAll(re)) {
        objects.push(kind === 'column' ? { kind, table: m[1], name: m[2] } : { kind, name: m[1] })
      }
    }
  }
  return objects
}

/**
 * Pure planner. `applied`: rows of drizzle.__drizzle_migrations (or null when the
 * table does not exist). `existing(obj)`: whether an object already exists.
 */
export function planMigrations(migrations, applied, existing = () => false) {
  const rows = applied ?? []
  const last = rows.reduce(
    (max, r) => Math.max(max, Number(r.created_at)),
    Number.NEGATIVE_INFINITY,
  )
  const byWhen = new Map(migrations.map((m) => [m.when, m]))
  const blockers = []

  for (const row of rows) {
    const m = byWhen.get(Number(row.created_at))
    if (!m)
      blockers.push({ reason: 'applied_unknown_to_journal', created_at: Number(row.created_at) })
    else if (m.hash !== row.hash) blockers.push({ reason: 'applied_file_changed', tag: m.tag })
  }

  const appliedTags = []
  const pending = []
  for (const m of migrations) {
    if (rows.length > 0 && m.when <= last) {
      if (rows.some((r) => Number(r.created_at) === m.when)) appliedTags.push(m.tag)
      else blockers.push({ reason: 'skipped_by_newer_applied', tag: m.tag })
    } else {
      pending.push(m)
    }
  }

  for (const m of pending) {
    for (const obj of createdObjects(m.statements)) {
      if (existing(obj)) blockers.push({ reason: 'schema_drift', tag: m.tag, object: obj })
    }
  }

  return {
    migrationsTable: applied === null ? 'absent' : 'present',
    journalCount: migrations.length,
    applied: appliedTags,
    pending: pending.map((m) => m.tag),
    blockers,
    pendingMigrations: pending,
  }
}

async function readApplied(tx) {
  const [{ present }] =
    await tx`select to_regclass('drizzle.__drizzle_migrations') is not null as present`
  if (!present) return null
  return tx`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at`
}

/** Looks up which of the pending migrations' objects already exist. */
async function existingObjects(tx, pending) {
  const found = new Set()
  for (const m of pending) {
    for (const obj of createdObjects(m.statements)) {
      let rows
      if (obj.kind === 'column') {
        rows = await tx`
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${obj.table} and column_name = ${obj.name}`
      } else if (obj.kind === 'constraint') {
        rows = await tx`
          select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
          where n.nspname = 'public' and c.conname = ${obj.name}`
      } else {
        rows = await tx`select 1 where to_regclass(${`public."${obj.name}"`}) is not null`
      }
      if (rows.length > 0) found.add(objectKey(obj))
    }
  }
  return (obj) => found.has(objectKey(obj))
}

function objectKey(obj) {
  return `${obj.kind}:${obj.table ?? ''}:${obj.name}`
}

/** Report of the state after this run (counts and migration tags only). */
export function summarize(plan, { mode, appliedNow = [] }) {
  const applied = [...plan.applied, ...appliedNow]
  const pending = plan.pending.filter((tag) => !appliedNow.includes(tag))
  return {
    mode,
    migrations_table: appliedNow.length > 0 ? 'present' : plan.migrationsTable,
    journal_count: plan.journalCount,
    applied_count: applied.length,
    last_applied: applied.at(-1) ?? null,
    pending_count: pending.length,
    pending,
    blockers: plan.blockers,
    applied_now: appliedNow,
  }
}

export async function runDbMigrate(sql, { migrations, apply, lockTimeout = '10s' }) {
  const mode = apply ? 'apply' : 'dry-run'
  if (!apply) {
    return sql.begin('read only', async (tx) => {
      await tx`set local statement_timeout = '60s'`
      const [{ transaction_read_only: ro }] = await tx`show transaction_read_only`
      if (ro !== 'on') throw new Error('transaction is not read-only; aborting')
      const applied = await readApplied(tx)
      const draft = planMigrations(migrations, applied)
      const exists = await existingObjects(tx, draft.pendingMigrations)
      return summarize(planMigrations(migrations, applied, exists), { mode })
    })
  }

  return sql.begin(async (tx) => {
    await tx.unsafe(`set local lock_timeout = '${lockTimeout}'`)
    await tx`set local statement_timeout = '15min'`
    await tx`select pg_advisory_xact_lock(${LOCK_KEY})`
    await tx`create schema if not exists drizzle`
    await tx`
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key,
        hash text not null,
        created_at bigint
      )`
    // Re-plan under the lock: another runner may have applied migrations meanwhile.
    const applied = await readApplied(tx)
    const draft = planMigrations(migrations, applied)
    const exists = await existingObjects(tx, draft.pendingMigrations)
    const plan = planMigrations(migrations, applied, exists)
    if (plan.blockers.length > 0) {
      return summarize(plan, { mode: 'apply-refused' })
    }
    const appliedNow = []
    for (const m of plan.pendingMigrations) {
      for (const stmt of m.statements) await tx.unsafe(stmt)
      await tx`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${m.hash}, ${m.when})`
      appliedNow.push(m.tag)
    }
    return summarize(plan, { mode, appliedNow })
  })
}

export function exitCodeFor(report, { failOnPending }) {
  if (report.blockers.length > 0) return EXIT.blocked
  if (failOnPending && report.pending_count > 0) return EXIT.pending
  return EXIT.ok
}

function printHuman(report) {
  const lines = [
    `mode: ${report.mode}${report.mode === 'dry-run' ? ' (no writes)' : ''}`,
    `migrations table: ${report.migrations_table}`,
    `journal: ${report.journal_count} migrations; applied ${report.applied_count} (last: ${report.last_applied ?? '—'})`,
    `pending: ${report.pending_count}${report.pending_count ? ` → ${report.pending.join(', ')}` : ''}`,
  ]
  for (const b of report.blockers) {
    const obj = b.object
      ? ` ${b.object.kind} ${b.object.table ? `${b.object.table}.` : ''}${b.object.name}`
      : ''
    lines.push(`BLOCKER ${b.reason}${b.tag ? ` (${b.tag})` : ''}${obj}`)
  }
  if (report.mode === 'apply-refused') lines.push('REFUSED: blockers present; nothing was written')
  if (report.mode === 'apply') {
    lines.push(
      `applied now: ${report.applied_now.length ? report.applied_now.join(', ') : 'none (already up to date)'}`,
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const url = process.env[args.databaseEnv]
  if (!url) {
    process.stderr.write(`${args.databaseEnv} is required\n`)
    process.exit(EXIT.usage)
  }
  const migrations = readMigrations(args.migrationsDir ?? resolveMigrationsDir())
  const resolved = resolvePostgresPath()
  const postgres = createRequire(resolved)(resolved)
  const sql = postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} })
  try {
    const report = await runDbMigrate(sql, {
      migrations,
      apply: args.apply,
      lockTimeout: args.lockTimeout,
    })
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else printHuman(report)
    process.exitCode = exitCodeFor(report, args)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const invokedPath = process.argv[1]
const isMain =
  !invokedPath ||
  invokedPath === '-' ||
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`db-migrate failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(EXIT.error)
  })
}

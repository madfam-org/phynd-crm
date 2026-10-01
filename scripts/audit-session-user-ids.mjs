#!/usr/bin/env node
/**
 * Read-only damage assessment for the per-login random session user id.
 *
 * Before `fix(auth): use the Janua subject as the session user id`, Auth.js v5
 * (JWT sessions, no adapter) minted `session.user.id` as a NEW
 * `crypto.randomUUID()` at every sign-in. Services persisted that value as the
 * acting user (activities.owner_id, notes.author_id, referral_codes.owner_janua_id,
 * campaign_authorizations.requested_by/decided_by, engagement event metadata, …).
 *
 * This script counts, per user-reference column, how many rows hold a value
 * that matches nothing known in this database, and over which date range.
 * It prints COUNTS AND DATES ONLY — never ids, emails or names.
 *
 * Classification of each stored value:
 *   janua_subject     — equals a users/contacts/leads.external_janua_id
 *   crm_user_id       — equals a users.id (expected for FK owner columns)
 *   service_or_system — 'service:*', 'system', 'dev-user', '<operator> (via service:*)'
 *   demo              — 'demo-*' (demo tenants)
 *   unmatched         — none of the above: candidate random per-login ids
 *
 * Note: Janua subjects and the random ids are both UUIDv4, so they cannot be
 * told apart by shape. "unmatched" means "not a Janua subject this database
 * knows about"; a real Janua user who has no linked users/contacts row also
 * lands there. Read the per-column distinct-value counts with that in mind:
 * many distinct values with one or two rows each is the per-login pattern.
 *
 * Safety: everything runs inside ONE `BEGIN READ ONLY` transaction with a
 * statement timeout; the transaction is rolled back at the end. No writes.
 *
 * Usage (local / port-forward):
 *   DATABASE_URL=postgresql://... node scripts/audit-session-user-ids.mjs [--json]
 *
 * Usage (in-cluster, piped from a checkout through the operator's cluster
 * access; the worker image ships `postgres` under node_modules/@phynd/db and has
 * DATABASE_URL in its environment). This is a read-only diagnostic, run under
 * the break-glass rules in AGENTS.md:
 *   kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
 *     node --input-type=module - < scripts/audit-session-user-ids.mjs
 *
 * Options:
 *   --json                  print the machine-readable report only
 *   --database-env <NAME>   read the URL from env NAME (e.g. DATABASE_URL_TABLACO)
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Columns that hold "who did this". `expr` is SQL over the table alias `t`. */
export const TARGETS = [
  { table: 'activities', column: 'owner_id', fk: true },
  { table: 'notifications', column: 'user_id', fk: true },
  { table: 'contacts', column: 'owner_id', fk: true },
  { table: 'leads', column: 'owner_id', fk: true },
  { table: 'opportunities', column: 'owner_id', fk: true },
  { table: 'quotes', column: 'owner_id', fk: true },
  { table: 'orders', column: 'owner_id', fk: true },
  { table: 'engagements', column: 'owner_id', fk: true },
  { table: 'grant_applications', column: 'owner_id', fk: true },
  { table: 'notes', column: 'author_id' },
  { table: 'stage_transitions', column: 'transitioned_by' },
  { table: 'ai_kanban_suggestions', column: 'reviewed_by' },
  { table: 'campaign_authorizations', column: 'requested_by' },
  { table: 'campaign_authorizations', column: 'decided_by' },
  { table: 'grant_applications', column: 'hitl_approved_by' },
  { table: 'grant_signal_audit', column: 'actor' },
  { table: 'consent_audit', column: 'actor' },
  { table: 'referral_codes', column: 'owner_janua_id' },
  { table: 'referrals', column: 'referrer_janua_id' },
  { table: 'engagement_events', column: 'metadata', path: ['published_by'] },
  { table: 'engagement_events', column: 'metadata', path: ['configured_by'] },
  { table: 'engagement_events', column: 'metadata', path: ['accepted_by'] },
  { table: 'engagement_events', column: 'metadata', path: ['resolution', 'resolved_by'] },
  { table: 'engagement_events', column: 'metadata', path: ['resolution', 'reconciled_by'] },
]

/** Preferred "when" column per row, first match wins. */
export const TIMESTAMP_COLUMNS = [
  'created_at',
  'transitioned_at',
  'decided_at',
  'reviewed_at',
  'updated_at',
]

export const CLASSES = ['janua_subject', 'crm_user_id', 'service_or_system', 'demo', 'unmatched']

export function targetLabel(target) {
  return target.path
    ? `${target.table}.${target.column}->${target.path.join('->')}`
    : `${target.table}.${target.column}`
}

const IDENT = /^[a-z_][a-z0-9_]*$/

/** SQL expression for the target's value, as text. Identifiers are allow-listed. */
export function valueExpression(target) {
  for (const part of [target.table, target.column, ...(target.path ?? [])]) {
    if (!IDENT.test(part)) throw new Error(`unsafe identifier: ${part}`)
  }
  if (!target.path) return `t."${target.column}"::text`
  const keys = target.path.map((k) => `'${k}'`)
  const last = keys.pop()
  const prefix = keys.map((k) => `->${k}`).join('')
  return `(t."${target.column}"${prefix}->>${last})`
}

/** Classify one stored actor value. Pure; never logs the value. */
export function classifyActor(value, { januaSubjects, crmUserIds }) {
  if (
    value.startsWith('service:') ||
    value === 'system' ||
    value === 'dev-user' ||
    /\(via service:[^)]+\)$/.test(value)
  ) {
    return 'service_or_system'
  }
  if (value.startsWith('demo-')) return 'demo'
  if (januaSubjects.has(value)) return 'janua_subject'
  if (crmUserIds.has(value)) return 'crm_user_id'
  return 'unmatched'
}

/**
 * Fold per-value rows ({ value, rows, first_at, last_at }) into per-class
 * counts. The returned object holds counts and ISO dates only.
 */
export function summarize(valueRows, known) {
  const out = Object.fromEntries(
    CLASSES.map((c) => [c, { rows: 0, distinct_values: 0, first_at: null, last_at: null }]),
  )
  for (const r of valueRows) {
    const bucket = out[classifyActor(String(r.value), known)]
    bucket.rows += Number(r.rows)
    bucket.distinct_values += 1
    const first = r.first_at ? new Date(r.first_at).toISOString() : null
    const last = r.last_at ? new Date(r.last_at).toISOString() : null
    if (first && (!bucket.first_at || first < bucket.first_at)) bucket.first_at = first
    if (last && (!bucket.last_at || last > bucket.last_at)) bucket.last_at = last
  }
  return out
}

function parseArgs(argv) {
  const args = { json: false, databaseEnv: 'DATABASE_URL' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') args.json = true
    else if (argv[i] === '--database-env') args.databaseEnv = argv[++i] ?? ''
    else if (argv[i] === '-') continue
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (!IDENT.test(args.databaseEnv.toLowerCase()))
    throw new Error('--database-env must be an env var name')
  return args
}

/** `postgres` lives under @phynd/db (pnpm strict layout), in the repo and in the worker image. */
function loadPostgres() {
  const cwd = process.cwd()
  const candidates = [
    () => path.join(cwd, 'node_modules/@phynd/db/package.json'), // worker image (/app)
    () => path.join(cwd, 'packages/db/package.json'), // repo checkout
    () => new URL('../packages/db/package.json', import.meta.url).href, // run by path from scripts/
    () => path.join(cwd, 'package.json'),
  ]
  for (const candidate of candidates) {
    try {
      return createRequire(candidate())('postgres')
    } catch {
      // try the next location
    }
  }
  throw new Error(
    'cannot resolve the `postgres` package; run from the repo root or the worker /app',
  )
}

async function existingColumns(tx) {
  const rows = await tx`
    select table_name, column_name
    from information_schema.columns
    where table_schema = current_schema()
  `
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, new Set())
    map.get(r.table_name).add(r.column_name)
  }
  return map
}

async function knownIdentities(tx, columns) {
  const januaSubjects = new Set()
  for (const table of ['users', 'contacts', 'leads']) {
    if (!columns.get(table)?.has('external_janua_id')) continue
    const rows = await tx.unsafe(
      `select distinct external_janua_id as v from "${table}" where external_janua_id is not null and external_janua_id <> ''`,
    )
    for (const r of rows) januaSubjects.add(r.v)
  }
  const crmUserIds = new Set()
  if (columns.get('users')?.has('id')) {
    for (const r of await tx`select id as v from users`) crmUserIds.add(r.v)
  }
  return { januaSubjects, crmUserIds }
}

async function usersOverview(tx, columns) {
  if (!columns.has('users')) return null
  const [row] = await tx`
    select
      count(*)::int as total,
      count(external_janua_id)::int as with_janua_id,
      count(*) filter (where id = external_janua_id)::int as id_equals_janua_id
    from users
  `
  return row
}

export async function runAudit(sql) {
  const report = {
    generated_at: new Date().toISOString(),
    read_only: true,
    users: null,
    columns: [],
  }
  try {
    await sql.begin('read only', async (tx) => {
      await tx`set local statement_timeout = '120s'`
      const [{ transaction_read_only: ro }] = await tx`show transaction_read_only`
      if (ro !== 'on') throw new Error('transaction is not read-only; aborting')

      const columns = await existingColumns(tx)
      const known = await knownIdentities(tx, columns)
      report.users = await usersOverview(tx, columns)
      report.known_janua_subjects = known.januaSubjects.size

      for (const target of TARGETS) {
        const label = targetLabel(target)
        const cols = columns.get(target.table)
        if (!cols?.has(target.column)) {
          report.columns.push({ column: label, status: 'absent' })
          continue
        }
        const ts = TIMESTAMP_COLUMNS.find((c) => cols.has(c))
        const expr = valueExpression(target)
        const at = ts ? `t."${ts}"` : 'null::timestamptz'
        const valueRows = await tx.unsafe(
          `select ${expr} as value, count(*)::int as rows, min(${at}) as first_at, max(${at}) as last_at
             from "${target.table}" t
            where ${expr} is not null and ${expr} <> ''
            group by 1`,
        )
        report.columns.push({
          column: label,
          status: 'ok',
          fk_to_users: Boolean(target.fk),
          timestamp_column: ts ?? null,
          classes: summarize(valueRows, known),
        })
      }
      // Never commit anything, even though nothing was written.
      throw new RollbackSignal()
    })
  } catch (err) {
    if (!(err instanceof RollbackSignal)) throw err
  }
  return report
}

class RollbackSignal extends Error {}

function printHuman(report) {
  const lines = []
  lines.push(`audit-session-user-ids  (read-only transaction, rolled back)  ${report.generated_at}`)
  if (report.users) {
    lines.push(
      `users: ${report.users.total} rows, ${report.users.with_janua_id} with external_janua_id, ${report.users.id_equals_janua_id} with id = external_janua_id`,
    )
  }
  lines.push(`known Janua subjects in this database: ${report.known_janua_subjects}`)
  lines.push('')
  lines.push('column | class | rows | distinct | first_at | last_at')
  for (const c of report.columns) {
    if (c.status !== 'ok') {
      lines.push(`${c.column} | (column absent)`)
      continue
    }
    for (const cls of CLASSES) {
      const b = c.classes[cls]
      if (b.rows === 0) continue
      lines.push(
        `${c.column}${c.fk_to_users ? ' [fk users.id]' : ''} | ${cls} | ${b.rows} | ${b.distinct_values} | ${b.first_at ?? '-'} | ${b.last_at ?? '-'}`,
      )
    }
  }
  const unmatched = report.columns
    .filter((c) => c.status === 'ok')
    .reduce((acc, c) => acc + c.classes.unmatched.rows, 0)
  lines.push('')
  lines.push(`TOTAL unmatched rows across columns: ${unmatched}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const url = process.env[args.databaseEnv]
  if (!url) {
    process.stderr.write(`${args.databaseEnv} is required\n`)
    process.exit(2)
  }
  const postgres = loadPostgres()
  const sql = postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} })
  try {
    const report = await runAudit(sql)
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else printHuman(report)
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
    process.stderr.write(
      `audit-session-user-ids failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  })
}

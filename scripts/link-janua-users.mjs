#!/usr/bin/env node
/**
 * Backfill helper for the Janua identity → CRM user link (owner-run).
 *
 * A signed-in Janua user acts as the CRM user whose `users.external_janua_id`
 * equals their Janua subject (docs/IDENTITY.md). CRM users are never created
 * at sign-in, so existing users need a link. This script:
 *
 *   1. lists CRM users with no `external_janua_id` (counts and short ids only);
 *   2. validates links you supply as `{ "<users.id>": "<janua sub>" }`;
 *   3. with `--apply`, writes the valid links in ONE transaction.
 *
 * It does not propose links by email: Phynd has no safe Janua lookup by email
 * (the Janua client here reads a user by id with the caller's token). Collect
 * subjects from the users themselves (an unlinked user sees theirs in the
 * notifications menu) or from Janua's admin console, or link one user at a time
 * in Settings → Users.
 *
 * Output: counts and the first 8 characters of `users.id` only — never emails,
 * names or Janua subjects.
 *
 * Safety:
 *   - dry-run is the default and runs in a `BEGIN READ ONLY` transaction;
 *   - `--apply` is all-or-nothing: if any requested link is invalid, nothing is
 *     written. Each UPDATE also requires `external_janua_id IS NULL`.
 *   - Web replicas cache "not linked" for up to 30 s; a linked user may need to
 *     wait that long or reload.
 *
 * Usage (local / port-forward):
 *   DATABASE_URL=postgresql://... node scripts/link-janua-users.mjs [--json]
 *   DATABASE_URL=... node scripts/link-janua-users.mjs --links links.json [--apply]
 *
 * Usage (in-cluster, piped from a checkout; see the break-glass rules in AGENTS.md):
 *   kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
 *     node --input-type=module - < scripts/link-janua-users.mjs
 *   … - --links-json '{"<users.id>":"<janua sub>"}' [--apply] < scripts/link-janua-users.mjs
 *
 * Options:
 *   --links <file>          JSON object mapping users.id → Janua subject
 *   --links-json <json>     the same mapping inline (for piped runs)
 *   --apply                 write the links (requires --links or --links-json)
 *   --json                  print the machine-readable report only
 *   --database-env <NAME>   read the URL from env NAME (e.g. DATABASE_URL_TABLACO)
 */

import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const IDENT = /^[a-z_][a-z0-9_]*$/
/** Same rule as `januaSubInput` in packages/api/src/routers/users.ts. */
const JANUA_SUB = /^[A-Za-z0-9][A-Za-z0-9._:@|-]*$/
const RESERVED_PRINCIPAL = /^(service:|demo-|system$|dev-user$)/

export const REASONS = [
  'unknown_user',
  'invalid_subject',
  'duplicate_subject',
  'subject_taken',
  'user_linked_elsewhere',
]

export function shortId(id) {
  return String(id).slice(0, 8)
}

export function isValidJanuaSub(sub) {
  return (
    typeof sub === 'string' &&
    sub.length > 0 &&
    sub.length <= 255 &&
    JANUA_SUB.test(sub) &&
    !RESERVED_PRINCIPAL.test(sub)
  )
}

/**
 * Plans the requested links against the current users.
 * `users`: [{ id, external_janua_id }]; `links`: { [usersId]: januaSub }.
 * Returns the writes to make, the no-ops and the rejections (by reason).
 */
export function planLinks(users, links) {
  const byId = new Map(users.map((u) => [u.id, u]))
  const holderOf = new Map(
    users.filter((u) => u.external_janua_id).map((u) => [u.external_janua_id, u.id]),
  )
  const subCounts = new Map()
  for (const raw of Object.values(links)) {
    const sub = String(raw).trim()
    subCounts.set(sub, (subCounts.get(sub) ?? 0) + 1)
  }

  const plan = { writes: [], alreadyLinked: [], rejected: [] }
  for (const [userId, rawSub] of Object.entries(links)) {
    const sub = typeof rawSub === 'string' ? rawSub.trim() : rawSub
    const user = byId.get(userId)
    let reason = null
    if (!user) reason = 'unknown_user'
    else if (!isValidJanuaSub(sub)) reason = 'invalid_subject'
    else if (subCounts.get(sub) > 1) reason = 'duplicate_subject'
    else if (user.external_janua_id === sub) {
      plan.alreadyLinked.push({ userId })
      continue
    } else if (user.external_janua_id) reason = 'user_linked_elsewhere'
    else if (holderOf.has(sub) && holderOf.get(sub) !== userId) reason = 'subject_taken'
    if (reason) plan.rejected.push({ userId, reason })
    else plan.writes.push({ userId, januaSub: sub })
  }
  return plan
}

/** Counts and short ids only. */
export function summarizeReport({ users, plan, applied, mode }) {
  const unlinked = users.filter((u) => !u.external_janua_id)
  const rejectedByReason = Object.fromEntries(REASONS.map((r) => [r, []]))
  for (const r of plan?.rejected ?? []) rejectedByReason[r.reason].push(shortId(r.userId))
  return {
    mode,
    users_total: users.length,
    users_linked: users.length - unlinked.length,
    users_unlinked: unlinked.length,
    unlinked_short_ids: unlinked.map((u) => shortId(u.id)).sort(),
    proposals_by_email: 'none: no safe Janua lookup by email in this repo',
    links_requested: plan ? plan.writes.length + plan.alreadyLinked.length + plan.rejected.length : 0,
    links_valid: plan?.writes.length ?? 0,
    links_already_in_place: plan?.alreadyLinked.length ?? 0,
    links_rejected: Object.fromEntries(
      Object.entries(rejectedByReason).map(([k, ids]) => [k, { count: ids.length, short_ids: ids }]),
    ),
    links_to_write_short_ids: (plan?.writes ?? []).map((w) => shortId(w.userId)),
    links_written: applied,
  }
}

export function parseArgs(argv) {
  const args = { json: false, apply: false, databaseEnv: 'DATABASE_URL', links: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--apply') args.apply = true
    else if (a === '--database-env') args.databaseEnv = argv[++i] ?? ''
    else if (a === '--links') args.links = JSON.parse(readFileSync(argv[++i] ?? '', 'utf8'))
    else if (a === '--links-json') args.links = JSON.parse(argv[++i] ?? '')
    else if (a === '-') continue
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!IDENT.test(args.databaseEnv.toLowerCase()))
    throw new Error('--database-env must be an env var name')
  if (args.links !== null) {
    const ok =
      typeof args.links === 'object' &&
      !Array.isArray(args.links) &&
      Object.values(args.links).every((v) => typeof v === 'string')
    if (!ok) throw new Error('links must be a JSON object of "<users.id>": "<janua sub>"')
  }
  if (args.apply && !args.links) throw new Error('--apply needs --links or --links-json')
  return args
}

/**
 * Absolute path of the `postgres` driver. Kept in sync with
 * scripts/audit-session-user-ids.mjs: in the worker image (`pnpm deploy`)
 * `node_modules/@phynd/db` is a symlink and `postgres` sits next to its real
 * path, so each base is resolved with realpath first. Inlined because the
 * script is also piped on stdin, where relative imports do not exist.
 */
export function resolvePostgresPath({ cwd = process.cwd(), scriptUrl = import.meta.url } = {}) {
  const bases = [path.join(cwd, 'node_modules/@phynd/db'), path.join(cwd, 'packages/db')]
  try {
    bases.push(path.join(path.dirname(fileURLToPath(scriptUrl)), '../packages/db'))
  } catch {
    // piped on stdin: no script file to resolve from
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
  throw new Error(
    `cannot resolve the \`postgres\` package from ${cwd}; run from the repo root (after pnpm install) or the worker /app`,
  )
}

export async function runLinkJanuaUsers(sql, { links, apply }) {
  const mode = apply ? 'apply' : 'dry-run'
  const work = async (tx) => {
    await tx`set local statement_timeout = '60s'`
    if (!apply) {
      const [{ transaction_read_only: ro }] = await tx`show transaction_read_only`
      if (ro !== 'on') throw new Error('transaction is not read-only; aborting')
    }
    const users = await tx`select id, external_janua_id from users order by id`
    const plan = links ? planLinks(users, links) : null
    let applied = 0
    if (apply && plan) {
      if (plan.rejected.length > 0) {
        return { users, plan, applied, aborted: true }
      }
      for (const w of plan.writes) {
        const rows = await tx`
          update users set external_janua_id = ${w.januaSub}, updated_at = now()
          where id = ${w.userId} and external_janua_id is null
          returning id`
        if (rows.length !== 1) throw new Error(`user ${shortId(w.userId)} changed concurrently`)
        applied++
      }
    }
    return { users, plan, applied, aborted: false }
  }
  const result = apply ? await sql.begin(work) : await sql.begin('read only', work)
  return {
    ...summarizeReport({ users: result.users, plan: result.plan, applied: result.applied, mode }),
    aborted_invalid_links: result.aborted,
  }
}

function printHuman(report) {
  const lines = [
    `mode: ${report.mode}${report.mode === 'dry-run' ? ' (no writes)' : ''}`,
    `users: ${report.users_total} total, ${report.users_linked} linked, ${report.users_unlinked} unlinked`,
    `unlinked (short ids): ${report.unlinked_short_ids.join(', ') || '—'}`,
    `proposals by email: ${report.proposals_by_email}`,
    `links requested: ${report.links_requested} — valid ${report.links_valid}, already in place ${report.links_already_in_place}`,
  ]
  for (const [reason, r] of Object.entries(report.links_rejected)) {
    if (r.count > 0) lines.push(`  rejected ${reason}: ${r.count} (${r.short_ids.join(', ')})`)
  }
  if (report.links_to_write_short_ids.length > 0) {
    lines.push(`would link (short ids): ${report.links_to_write_short_ids.join(', ')}`)
  }
  if (report.aborted_invalid_links) lines.push('ABORTED: invalid links present; nothing was written')
  if (report.mode === 'apply') lines.push(`links written: ${report.links_written}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const url = process.env[args.databaseEnv]
  if (!url) {
    process.stderr.write(`${args.databaseEnv} is required\n`)
    process.exit(2)
  }
  const resolved = resolvePostgresPath()
  const postgres = createRequire(resolved)(resolved)
  const sql = postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} })
  try {
    const report = await runLinkJanuaUsers(sql, { links: args.links, apply: args.apply })
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else printHuman(report)
    if (report.aborted_invalid_links) process.exitCode = 3
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
      `link-janua-users failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  })
}

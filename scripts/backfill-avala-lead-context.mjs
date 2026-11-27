#!/usr/bin/env node
/**
 * Backfill of the Avala lead context (owner-run).
 *
 * Until the Avala receiver kept them, an `avala.lead.captured` lead lost the
 * prospect's message and lead type: they survive only in the raw
 * `webhook_events` record. For every such record this script finds the CRM
 * lead it created (the `visitor_to_lead` conversion with the same `event_id`,
 * else the same `avala_lead_id`) and writes what the receiver writes today
 * (apps/web/src/lib/webhooks/avala-lead-context.ts):
 *
 *   - one note on the lead, authored by `service:avala`: the message and the
 *     context lines (page, lead type, standard, intent, interests);
 *   - the attribution keys the lead lacks (`landing_page`, `utm_*`,
 *     `lead_type`); keys the lead already has are never changed.
 *
 * It opens no task and sets no owner. A lead that already has a
 * `service:avala` note gets no second one, so a second run writes nothing.
 * Deleted leads and redacted records (an Avala deletion) are skipped.
 *
 * Output: counts only — never names, emails, messages or ids.
 *
 * Safety:
 *   - dry-run is the default and runs in a `BEGIN READ ONLY` transaction;
 *   - `--apply` writes everything in ONE transaction (all or nothing).
 *
 * Usage (local / port-forward):
 *   DATABASE_URL=postgresql://... node scripts/backfill-avala-lead-context.mjs [--json]
 *   DATABASE_URL=... node scripts/backfill-avala-lead-context.mjs --apply
 *
 * Usage (in-cluster, piped from a checkout; see the break-glass rules in AGENTS.md):
 *   kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
 *     node --input-type=module - [--apply] < scripts/backfill-avala-lead-context.mjs
 *
 * Options:
 *   --apply                 write the notes and attribution
 *   --json                  print the machine-readable report only
 *   --database-env <NAME>   read the URL from env NAME (e.g. DATABASE_URL_TABLACO)
 */

import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const IDENT = /^[a-z_][a-z0-9_]*$/

// ---------------------------------------------------------------------------
// Same rules as apps/web/src/lib/webhooks/avala-lead-context.ts and
// packages/services/src/leads/lead-attribution.ts. Inlined because the script
// is also piped on stdin; apps/web/src/lib/webhooks/__tests__/
// avala-lead-context.test.ts fails when the two drift apart.
// ---------------------------------------------------------------------------

export const AVALA_SERVICE_ACTOR = 'service:avala'
const MAX_INTERESTS = 20
const ATTRIBUTION_LIMITS = {
  utm_source: 255,
  utm_medium: 255,
  utm_campaign: 255,
  landing_page: 500,
  lead_type: 255,
}
const WAITLIST_LINE =
  'lista de espera: no es un prospecto de venta; avisar cuando el estándar esté disponible.'

function readObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function readString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function readAvalaLeadContext(payload) {
  const lead = readObject(payload.lead)
  const attribution = readObject(payload.attribution)
  const interests = Array.isArray(lead.interests)
    ? lead.interests
        .map(readString)
        .filter((value) => value !== undefined)
        .slice(0, MAX_INTERESTS)
    : []
  return {
    avalaLeadId: readString(lead.id),
    source: readString(lead.source) ?? 'avala',
    message: readString(lead.message),
    leadType: readString(lead.leadType),
    ecCode: readString(lead.ecCode),
    intent: readString(attribution.intent),
    interests,
    sourcePage: readString(attribution.sourcePage),
    utmSource: readString(attribution.utmSource),
    utmMedium: readString(attribution.utmMedium),
    utmCampaign: readString(attribution.utmCampaign),
  }
}

function isAvalaWaitlistLead(context) {
  return context.source === 'ec_waitlist' || context.interests.includes('waitlist')
}

export function avalaLeadAttribution(context) {
  const values = {
    utm_source: context.utmSource,
    utm_medium: context.utmMedium,
    utm_campaign: context.utmCampaign,
    landing_page: context.sourcePage,
    lead_type: context.leadType,
  }
  const attribution = {}
  for (const [key, max] of Object.entries(ATTRIBUTION_LIMITS)) {
    const value = values[key]
    if (typeof value === 'string' && value.trim() !== '') attribution[key] = value.trim().slice(0, max)
  }
  return Object.keys(attribution).length > 0 ? attribution : null
}

export function avalaLeadNote(context) {
  const origin = ['— vía formulario de Avala']
  if (context.sourcePage) origin.push(context.sourcePage)
  const lines = [context.message ?? '(sin mensaje)', '', origin.join(' · ')]
  lines.push(`— origen en Avala: ${context.source}`)
  if (context.leadType) lines.push(`— tipo de lead: ${context.leadType}`)
  if (context.ecCode) lines.push(`— estándar: ${context.ecCode}`)
  if (context.intent) lines.push(`— intención: ${context.intent}`)
  if (context.interests.length > 0) lines.push(`— intereses: ${context.interests.join(', ')}`)
  if (isAvalaWaitlistLead(context)) lines.push(`— ${WAITLIST_LINE}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Plan and run
// ---------------------------------------------------------------------------

/** The attribution keys `computed` has and `existing` lacks, or null. */
export function missingAttribution(existing, computed) {
  if (!computed) return null
  const current = readObject(existing)
  const missing = {}
  for (const [key, value] of Object.entries(computed)) {
    if (current[key] === undefined || current[key] === null) missing[key] = value
  }
  return Object.keys(missing).length > 0 ? missing : null
}

/**
 * What to write for one capture record. `lead`: the CRM lead it created
 * (`{ id, attribution, deleted_at, has_avala_note }`) or null.
 */
export function planEvent(envelope, lead) {
  if (envelope?.redacted === true) return { status: 'redacted' }
  if (!lead) return { status: 'no_lead' }
  if (lead.deleted_at) return { status: 'lead_deleted' }
  const context = readAvalaLeadContext(readObject(envelope?.payload))
  return {
    status: 'planned',
    leadId: lead.id,
    note: lead.has_avala_note ? null : avalaLeadNote(context),
    attribution: missingAttribution(lead.attribution, avalaLeadAttribution(context)),
    hasMessage: context.message !== undefined,
  }
}

export function emptyReport(mode) {
  return {
    mode,
    capture_events: 0,
    skipped_redacted: 0,
    skipped_no_lead: 0,
    skipped_lead_deleted: 0,
    leads_matched: 0,
    notes_to_write: 0,
    notes_with_message: 0,
    notes_already_present: 0,
    attributions_to_fill: 0,
    notes_written: 0,
    attributions_written: 0,
  }
}

async function findLead(tx, eventId, avalaLeadId) {
  const byEvent = eventId
    ? await tx`
        select l.id, l.attribution, l.deleted_at
        from conversions c join leads l on l.id = c.lead_id
        where c.type = 'visitor_to_lead' and c.metadata ->> 'event_id' = ${eventId}
        order by l.created_at limit 1`
    : []
  const rows =
    byEvent.length > 0 || !avalaLeadId
      ? byEvent
      : await tx`
          select l.id, l.attribution, l.deleted_at
          from conversions c join leads l on l.id = c.lead_id
          where c.type = 'visitor_to_lead' and c.metadata ->> 'avala_lead_id' = ${avalaLeadId}
          order by l.created_at limit 1`
  const [lead] = rows
  if (!lead) return null
  const notes = await tx`
    select 1 from notes
    where entity_type = 'lead' and entity_id = ${lead.id} and author_id = ${AVALA_SERVICE_ACTOR}
    limit 1`
  return { ...lead, has_avala_note: notes.length > 0 }
}

export async function runBackfill(sql, { apply }) {
  const report = emptyReport(apply ? 'apply' : 'dry-run')
  const work = async (tx) => {
    await tx`set local statement_timeout = '120s'`
    if (!apply) {
      const [{ transaction_read_only: ro }] = await tx`show transaction_read_only`
      if (ro !== 'on') throw new Error('transaction is not read-only; aborting')
    }
    const events = await tx`
      select id, payload, created_at from webhook_events
      where provider = 'avala' and event_type = 'avala.lead.captured'
      order by created_at, id`
    const seenLeads = new Set()
    for (const event of events) {
      report.capture_events++
      const envelope = readObject(event.payload)
      const lead =
        envelope.redacted === true
          ? null
          : await findLead(
              tx,
              readString(envelope.event_id),
              readString(readObject(readObject(envelope.payload).lead).id),
            )
      const plan = planEvent(envelope, lead)
      if (plan.status !== 'planned') {
        report[`skipped_${plan.status}`]++
        continue
      }
      // Two records for one lead (a redelivery with a new id): the first wins.
      if (seenLeads.has(plan.leadId)) continue
      seenLeads.add(plan.leadId)
      report.leads_matched++
      if (plan.note) {
        report.notes_to_write++
        if (plan.hasMessage) report.notes_with_message++
      } else {
        report.notes_already_present++
      }
      if (plan.attribution) report.attributions_to_fill++
      if (!apply) continue

      if (plan.note) {
        await tx`
          insert into notes (id, content, entity_type, entity_id, author_id, is_pinned, created_at, updated_at)
          values (${randomUUID()}, ${plan.note}, 'lead', ${plan.leadId}, ${AVALA_SERVICE_ACTOR},
                  false, ${event.created_at}, now())`
        report.notes_written++
      }
      if (plan.attribution) {
        await tx`
          update leads
          set attribution = coalesce(attribution, '{}'::jsonb) || ${tx.json(plan.attribution)},
              updated_at = now()
          where id = ${plan.leadId}`
        report.attributions_written++
      }
    }
  }
  if (apply) await sql.begin(work)
  else await sql.begin('read only', work)
  return report
}

export function parseArgs(argv) {
  const args = { json: false, apply: false, databaseEnv: 'DATABASE_URL' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--apply') args.apply = true
    else if (a === '--database-env') args.databaseEnv = argv[++i] ?? ''
    else if (a === '-') continue
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!IDENT.test(args.databaseEnv.toLowerCase()))
    throw new Error('--database-env must be an env var name')
  return args
}

/** Same resolution as scripts/link-janua-users.mjs (see resolve-postgres.test.mjs). */
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

function printHuman(report) {
  const lines = [
    `mode: ${report.mode}${report.mode === 'dry-run' ? ' (no writes)' : ''}`,
    `avala.lead.captured records: ${report.capture_events}`,
    `skipped: ${report.skipped_no_lead} without a CRM lead, ${report.skipped_lead_deleted} on deleted leads, ${report.skipped_redacted} redacted`,
    `leads matched: ${report.leads_matched}`,
    `notes: ${report.notes_to_write} to write (${report.notes_with_message} with a message), ${report.notes_already_present} already present`,
    `attribution: ${report.attributions_to_fill} leads to fill`,
  ]
  if (report.mode === 'apply') {
    lines.push(`written: ${report.notes_written} notes, ${report.attributions_written} attributions`)
  }
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
    const report = await runBackfill(sql, { apply: args.apply })
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
      `backfill-avala-lead-context failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  })
}

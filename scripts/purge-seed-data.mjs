#!/usr/bin/env node
/**
 * Purge synthetic seed data from a PhyndCRM database (MADFAM tenant truth,
 * roadmap WS5.6 "replace synthetic seed contacts in prod").
 *
 * Removes exactly the rows planted by `packages/db/src/seed/*` — identified by
 * the seed's stable markers (emails, quote/order numbers, session ids, offer/
 * campaign names, external refs) plus every polymorphic row (activities,
 * notes, external_references, stage_transitions, taggables) pointing at a
 * purged entity. Preserves everything else: real contacts/events, structural
 * config (pipelines, stages, scoring rules, tags), and user rows (seed users
 * are REPORTED, not deleted — real rows may reference them as owners).
 *
 * Tablaco is EXCLUDED by default: it is both a seed fixture and a real
 * reference engagement. Pass --include-tablaco only if the operator confirms
 * the Tablaco rows in this database are the synthetic fixture.
 *
 * Safety: runs every delete inside a transaction and ROLLS BACK unless
 * --confirm is passed, so the dry run reports exact counts.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/purge-seed-data.mjs            # dry run
 *   DATABASE_URL=postgresql://... node scripts/purge-seed-data.mjs --confirm  # execute
 *   ... --confirm --include-tablaco                                           # also purge tablaco fixture
 *
 * Enclii-first: run from a trusted operator shell (e.g. via port-forward or an
 * in-cluster job) — never commit DATABASE_URL values.
 */

import { createRequire } from 'node:module'

// Resolve `postgres` from @phynd/db's dependency graph (pnpm strict layout).
const require = createRequire(new URL('../packages/db/package.json', import.meta.url))
const postgres = require('postgres')

const SEED_CONTACT_EMAILS = [
  'alice@techcorp.com',
  'bob@designlab.com',
  'carol@mfgworks.com',
  'david@innovatech.com',
  'emma@retailplus.com',
]
const TABLACO_CONTACT_EMAILS = ['rodrigo@tablaco.mx']
const SEED_USER_EMAILS = ['system@phynd.io', 'dev@madfam.com']
const SEED_QUOTE_NUMBERS = ['Q-2025-001', 'Q-2025-002', 'Q-2025-003']
const SEED_ORDER_NUMBERS = ['ORD-2025-001', 'ORD-2025-002', 'ORD-2025-003']
const SEED_SESSION_EXTERNAL_IDS = ['sess-001', 'sess-002', 'sess-003']
const SEED_OFFER_NAMES = [
  'Early Adopter Discount',
  'Free Trial - 30 Days',
  'Referral Reward — 1 Month Free',
]
const SEED_CAMPAIGN_NAMES = [
  'Q1 Product Launch',
  'Trade Show Follow-up',
  'MADFAM Ecosystem Referral Program',
]
const SEED_EXTERNAL_REF_IDS = ['janua-user-001', 'dhanam-cust-001', 'pravara-contact-001']
const TABLACO_EXTERNAL_REF_IDS = ['janua-tablaco-001', 'dhanam-tablaco-001', 'cotiza-tablaco-001']
const TABLACO_TAG_NAMES = ['tablaco', 'yantra4d', 'phase-1', '3-installment']

function parseArgs(argv) {
  return {
    confirm: argv.includes('--confirm'),
    includeTablaco: argv.includes('--include-tablaco'),
  }
}

function requireDatabaseUrl() {
  const raw = (process.env.DATABASE_URL ?? '').trim()
  if (!raw) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error(`unsupported protocol ${parsed.protocol}`)
    }
  } catch (err) {
    console.error(`DATABASE_URL is not a valid postgres URL: ${err.message}`)
    process.exit(1)
  }
  return raw
}

async function main() {
  const { confirm, includeTablaco } = parseArgs(process.argv.slice(2))
  const sql = postgres(requireDatabaseUrl(), { max: 1 })
  const report = []
  const note = (table, rows, detail = '') =>
    report.push({ table, count: rows.length, detail })

  try {
    await sql.begin(async (tx) => {
      const contactEmails = includeTablaco
        ? [...SEED_CONTACT_EMAILS, ...TABLACO_CONTACT_EMAILS]
        : SEED_CONTACT_EMAILS
      const externalRefIds = includeTablaco
        ? [...SEED_EXTERNAL_REF_IDS, ...TABLACO_EXTERNAL_REF_IDS]
        : SEED_EXTERNAL_REF_IDS

      // 1. Anchor entities
      const contacts = await tx`
        SELECT id, email FROM contacts WHERE email IN ${tx(contactEmails)}`
      const contactIds = contacts.map((r) => r.id)

      const leads = contactIds.length
        ? await tx`SELECT id FROM leads WHERE contact_id IN ${tx(contactIds)}`
        : []
      const leadIds = leads.map((r) => r.id)

      const opps = contactIds.length
        ? await tx`SELECT id FROM opportunities WHERE contact_id IN ${tx(contactIds)}`
        : []
      const oppIds = opps.map((r) => r.id)

      const quotes = await tx`
        SELECT id FROM quotes
        WHERE quote_number IN ${tx(SEED_QUOTE_NUMBERS)}
          ${oppIds.length ? tx`OR opportunity_id IN ${tx(oppIds)}` : tx``}`
      const quoteIds = quotes.map((r) => r.id)

      const orders = await tx`
        SELECT id FROM orders
        WHERE order_number IN ${tx(SEED_ORDER_NUMBERS)}
          ${quoteIds.length ? tx`OR quote_id IN ${tx(quoteIds)}` : tx``}
          ${contactIds.length ? tx`OR contact_id IN ${tx(contactIds)}` : tx``}`
      const orderIds = orders.map((r) => r.id)

      const sessions = await tx`
        SELECT id FROM visitor_sessions
        WHERE external_session_id IN ${tx(SEED_SESSION_EXTERNAL_IDS)}
          ${contactIds.length ? tx`OR contact_id IN ${tx(contactIds)}` : tx``}`
      const sessionIds = sessions.map((r) => r.id)

      const offers = await tx`SELECT id, name FROM offers WHERE name IN ${tx(SEED_OFFER_NAMES)}`
      const offerIds = offers.map((r) => r.id)
      const campaigns = await tx`
        SELECT id, name FROM campaigns WHERE name IN ${tx(SEED_CAMPAIGN_NAMES)}`
      const campaignIds = campaigns.map((r) => r.id)

      const allEntityIds = [
        ...contactIds, ...leadIds, ...oppIds, ...quoteIds, ...orderIds,
        ...sessionIds, ...offerIds, ...campaignIds,
      ]

      // 2. Delete children -> parents (RETURNING gives exact counts)
      const del = async (label, query) => note(label, await query)

      if (allEntityIds.length) {
        await del('activities', tx`
          DELETE FROM activities WHERE entity_id IN ${tx(allEntityIds)} RETURNING id`)
        await del('notes', tx`
          DELETE FROM notes WHERE entity_id IN ${tx(allEntityIds)} RETURNING id`)
        await del('stage_transitions', tx`
          DELETE FROM stage_transitions WHERE entity_id IN ${tx(allEntityIds)} RETURNING entity_id`)
        await del('taggables', tx`
          DELETE FROM taggables WHERE entity_id IN ${tx(allEntityIds)} RETURNING entity_id`)
        await del('external_references (by entity)', tx`
          DELETE FROM external_references WHERE entity_id IN ${tx(allEntityIds)} RETURNING id`)
      }
      await del('external_references (by seed external_id)', tx`
        DELETE FROM external_references WHERE external_id IN ${tx(externalRefIds)} RETURNING id`)

      const conversionFilters = []
      if (contactIds.length) conversionFilters.push(tx`contact_id IN ${tx(contactIds)}`)
      if (leadIds.length) conversionFilters.push(tx`lead_id IN ${tx(leadIds)}`)
      if (oppIds.length) conversionFilters.push(tx`opportunity_id IN ${tx(oppIds)}`)
      if (conversionFilters.length) {
        let where = conversionFilters[0]
        for (const f of conversionFilters.slice(1)) where = tx`${where} OR ${f}`
        await del('conversions', tx`DELETE FROM conversions WHERE ${where} RETURNING id`)
      }

      if (sessionIds.length) {
        // visitor_page_views cascade on session delete
        await del('visitor_sessions (+page views via cascade)', tx`
          DELETE FROM visitor_sessions WHERE id IN ${tx(sessionIds)} RETURNING id`)
      }
      if (orderIds.length)
        await del('orders', tx`DELETE FROM orders WHERE id IN ${tx(orderIds)} RETURNING id`)
      if (quoteIds.length)
        await del('quotes', tx`DELETE FROM quotes WHERE id IN ${tx(quoteIds)} RETURNING id`)
      if (oppIds.length)
        await del('opportunities', tx`
          DELETE FROM opportunities WHERE id IN ${tx(oppIds)} RETURNING id`)
      if (leadIds.length)
        await del('leads', tx`DELETE FROM leads WHERE id IN ${tx(leadIds)} RETURNING id`)
      if (contactIds.length)
        await del('contacts', tx`
          DELETE FROM contacts WHERE id IN ${tx(contactIds)} RETURNING email`)

      // Campaigns/offers: delete per-row inside a savepoint so a row still
      // referenced by REAL data (conversions, imports, email events, draft
      // variants, SKU rows, ...) is kept and reported instead of aborting —
      // robust against future child tables without enumerating them.
      const deleteGuarded = async (label, rows, buildDelete) => {
        const deleted = []
        const kept = []
        for (const row of rows) {
          try {
            await tx.savepoint((sp) => buildDelete(sp, row))
            deleted.push(row)
          } catch (err) {
            if (err.code !== '23503') throw err // only FK violations are expected
            kept.push(row)
          }
        }
        note(label, deleted)
        if (kept.length) {
          note(`${label} (KEPT: still referenced by real rows)`, kept,
            kept.map((r) => r.name ?? r.id).join(', '))
        }
      }

      // offers last: campaigns reference offers via campaigns.offer_id
      await deleteGuarded('campaigns', campaigns, (sp, row) =>
        sp`DELETE FROM campaigns WHERE id = ${row.id}`)
      await deleteGuarded('offers', offers, (sp, row) =>
        sp`DELETE FROM offers WHERE id = ${row.id}`)

      if (includeTablaco) {
        await del('tags (tablaco fixture)', tx`
          DELETE FROM tags WHERE name IN ${tx(TABLACO_TAG_NAMES)} RETURNING name`)
      }

      // 4. Seed users: notifications purged, user rows reported only
      const seedUsers = await tx`
        SELECT id, email FROM users WHERE email IN ${tx(SEED_USER_EMAILS)}`
      if (seedUsers.length) {
        await del('notifications (seed users)', tx`
          DELETE FROM notifications WHERE user_id IN ${tx(seedUsers.map((r) => r.id))} RETURNING id`)
        note('users (KEPT — may own real rows; remove manually if desired)', seedUsers,
          seedUsers.map((r) => r.email).join(', '))
      }

      // 5. Commit or roll back
      if (!confirm) {
        throw new Error('__DRY_RUN_ROLLBACK__')
      }
    })
  } catch (err) {
    if (err.message !== '__DRY_RUN_ROLLBACK__') throw err
  } finally {
    await sql.end()
  }

  const mode = confirm ? 'EXECUTED' : 'DRY RUN (rolled back)'
  console.log(`\nPurge seed data — ${mode}${includeTablaco ? ' [tablaco included]' : ' [tablaco excluded]'}`)
  for (const { table, count, detail } of report) {
    console.log(`  ${table}: ${count}${detail ? `  (${detail})` : ''}`)
  }
  if (!report.length) console.log('  nothing matched the seed markers — database is already clean')
  if (!confirm) console.log('\nRe-run with --confirm to apply.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

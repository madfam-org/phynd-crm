import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { isFeatureEnabled } from '@phynd/config/features'
import { getDb } from '@phynd/db'
import {
  activities,
  contacts,
  conversions,
  dataBackfills,
  leads,
  notes,
  webhookEvents,
} from '@phynd/db/schema'
import { createLogger } from '@phynd/logging'
import { LeadScoringService, type Transaction, findDefaultOwner } from '@phynd/services'
import {
  avalaLeadAttribution,
  avalaLeadMessage,
  avalaMessageNote,
  mergeLeadAttribution,
} from '@phynd/services/leads/avala-lead-context'
import {
  FIRST_CONTACT_TASK_KIND,
  firstContactTitle,
  nextBusinessDayDueAt,
} from '@phynd/services/leads/lead-intake-defaults'
import type { LeadAttribution } from '@phynd/types/crm'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getCacheManager } from '../lib/federation'

// One-off backfill of the lead-intake fixes (G1, G2) for leads that arrived
// before them, run by the worker at start-up because it needs the runtime
// configuration a SQL migration does not have (the default owner). The
// synthetic-lead sweep (G5), the scoring rules and the first-contact marker on
// existing intake tasks are in migration 0024 and have already run.
//
// Every step is a rule over stored data, idempotent, and never names a person:
//   1. Avala context: for each stored `avala.lead.captured` event, the lead it
//      created (matched through its `visitor_to_lead` conversion) gets the
//      event's EC code, intent, lead kind and interests on its attribution
//      (missing keys only), and the contact gets the message note unless an
//      identical one is already there.
//   2. Scores: every live lead is scored with the active rules (score + tier).
//   3. Owner: every live, non-test lead without owner gets its contact's owner,
//      else the configured default owner.
//   4. Task: every live, non-test lead still `new` without a first-contact task
//      gets one, due the next business day, owned by the lead's owner.
// Steps 3-4 need the default owner. While it is unset or names no CRM user,
// they are skipped, the run is not recorded, and the next start tries again.

const logger = createLogger('worker:lead-intake-backfill')

/** `data_backfills.name` of this run. */
export const LEAD_INTAKE_BACKFILL_NAME = 'lead-intake-g1-g2-2026-11-17'

type Db = ReturnType<typeof getDb>
type Handle = Db | Transaction

export interface BackfillLeadRow {
  id: string
  ownerId: string | null
  contactOwnerId: string | null
  status: string
  hasFirstContactTask: boolean
  name: string | null
}

export interface BackfillPlan {
  /** Lead id → owner to set. */
  ownerUpdates: Map<string, string>
  /** Leads that get a first-contact task, with its owner. */
  tasks: { leadId: string; ownerId: string | null; name: string | null }[]
}

/**
 * Steps 3 and 4 as a pure rule over live, non-test leads: an owner for every
 * lead without one (the contact's owner, else the default owner), and a task
 * for every `new` lead without one, owned by the lead's (new) owner.
 */
export function planOwnersAndTasks(rows: BackfillLeadRow[], defaultOwnerId: string): BackfillPlan {
  const ownerUpdates = new Map<string, string>()
  const tasks: BackfillPlan['tasks'] = []
  for (const row of rows) {
    let ownerId = row.ownerId
    if (!ownerId) {
      ownerId = row.contactOwnerId ?? defaultOwnerId
      ownerUpdates.set(row.id, ownerId)
    }
    if (row.status === 'new' && !row.hasFirstContactTask) {
      tasks.push({ leadId: row.id, ownerId, name: row.name })
    }
  }
  return { ownerUpdates, tasks }
}

/** Step 1 for one lead: the attribution to write (null = unchanged). */
export function plannedAvalaAttribution(
  current: LeadAttribution | null,
  payload: unknown,
): LeadAttribution | null {
  const merged = mergeLeadAttribution(current, avalaLeadAttribution(payload))
  return JSON.stringify(merged ?? null) === JSON.stringify(current ?? null) ? null : merged
}

function serviceContext(db: Handle) {
  return {
    db: db as Db,
    cache: getCacheManager(),
    auth: {
      userId: 'system',
      tenantId: DEFAULT_TENANT_ID,
      roles: ['system'],
      scopes: ['*'],
      accessToken: '',
    },
    tenantId: DEFAULT_TENANT_ID,
  }
}

async function backfillAvalaContext(tx: Handle): Promise<{ attributions: number; notes: number }> {
  const events = await tx
    .select({ payload: webhookEvents.payload })
    .from(webhookEvents)
    .where(
      and(eq(webhookEvents.provider, 'avala'), eq(webhookEvents.eventType, 'avala.lead.captured')),
    )

  let attributions = 0
  let notesCreated = 0
  for (const { payload } of events) {
    const result = await backfillAvalaEvent(tx, payload)
    if (result.attribution) attributions += 1
    if (result.note) notesCreated += 1
  }
  return { attributions, notes: notesCreated }
}

/** Step 1 for one stored event: the lead it created, then its attribution and the note. */
async function backfillAvalaEvent(
  tx: Handle,
  envelope: unknown,
): Promise<{ attribution: boolean; note: boolean }> {
  const none = { attribution: false, note: false }
  const event = (envelope ?? {}) as { event_id?: unknown; payload?: unknown }
  if (typeof event.event_id !== 'string') return none
  const [match] = await tx
    .select({ leadId: conversions.leadId, contactId: conversions.contactId })
    .from(conversions)
    .where(
      and(
        eq(conversions.type, 'visitor_to_lead'),
        sql`${conversions.metadata} ->> 'event_id' = ${event.event_id}`,
        sql`${conversions.leadId} is not null`,
      ),
    )
    .limit(1)
  if (!match?.leadId) return none

  const [lead] = await tx
    .select({ attribution: leads.attribution, contactId: leads.contactId })
    .from(leads)
    .where(eq(leads.id, match.leadId))
    .limit(1)
  if (!lead) return none

  const next = plannedAvalaAttribution(lead.attribution ?? null, event.payload)
  if (next) await tx.update(leads).set({ attribution: next }).where(eq(leads.id, match.leadId))

  const contactId = lead.contactId ?? match.contactId
  const message = avalaLeadMessage(event.payload)
  const note = contactId && message ? await ensureMessageNote(tx, contactId, message) : false
  return { attribution: next !== null, note }
}

/** The message note on the contact unless an identical one is there. True when written. */
async function ensureMessageNote(tx: Handle, contactId: string, message: string): Promise<boolean> {
  const content = avalaMessageNote(message)
  const [existing] = await tx
    .select({ id: notes.id })
    .from(notes)
    .where(
      and(
        eq(notes.entityType, 'contact'),
        eq(notes.entityId, contactId),
        eq(notes.content, content),
      ),
    )
    .limit(1)
  if (existing) return false
  await tx
    .insert(notes)
    .values({ content, entityType: 'contact', entityId: contactId, authorId: 'system' })
  return true
}

async function rescoreAll(tx: Handle): Promise<number> {
  if (!isFeatureEnabled('leadScoring')) return 0
  const rows = await tx.select({ id: leads.id }).from(leads).where(isNull(leads.deletedAt))
  const service = new LeadScoringService(serviceContext(tx))
  for (const row of rows) await service.computeScore(row.id)
  return rows.length
}

async function liveLeadRows(tx: Handle): Promise<BackfillLeadRow[]> {
  return tx
    .select({
      id: leads.id,
      ownerId: leads.ownerId,
      contactOwnerId: contacts.ownerId,
      status: leads.status,
      name: contacts.name,
      hasFirstContactTask: sql<boolean>`exists (
        select 1 from ${activities} a
        where a.entity_type = 'lead' and a.entity_id = ${leads.id} and a.kind = ${FIRST_CONTACT_TASK_KIND}
      )`,
    })
    .from(leads)
    .leftJoin(contacts, eq(contacts.id, leads.contactId))
    .where(and(isNull(leads.deletedAt), eq(leads.isTest, false)))
}

async function applyOwnersAndTasks(tx: Handle, plan: BackfillPlan): Promise<void> {
  const byOwner = new Map<string, string[]>()
  for (const [leadId, ownerId] of plan.ownerUpdates) {
    byOwner.set(ownerId, [...(byOwner.get(ownerId) ?? []), leadId])
  }
  for (const [ownerId, ids] of byOwner) {
    await tx
      .update(leads)
      .set({ ownerId })
      .where(and(inArray(leads.id, ids), isNull(leads.ownerId)))
  }
  if (plan.tasks.length === 0) return
  const dueAt = nextBusinessDayDueAt()
  await tx.insert(activities).values(
    plan.tasks.map((task) => ({
      type: 'task',
      kind: FIRST_CONTACT_TASK_KIND,
      title: firstContactTitle(task.name),
      description:
        'Abierta por la migración de leads: este lead no tenía tarea de primer contacto.',
      dueAt,
      entityType: 'lead',
      entityId: task.leadId,
      ownerId: task.ownerId,
    })),
  )
}

/**
 * Runs the backfill once. Safe to call on every start: it is serialised by an
 * advisory lock and skipped once recorded in `data_backfills`.
 */
export async function runLeadIntakeBackfill(db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${LEAD_INTAKE_BACKFILL_NAME}, 0))`,
    )
    const [done] = await tx
      .select({ name: dataBackfills.name })
      .from(dataBackfills)
      .where(eq(dataBackfills.name, LEAD_INTAKE_BACKFILL_NAME))
      .limit(1)
    if (done) return

    const avala = await backfillAvalaContext(tx)
    const scored = await rescoreAll(tx)

    const defaultOwnerId = await findDefaultOwner(tx)
    if (!defaultOwnerId) {
      logger.warn(
        { code: 'DEFAULT_TASK_OWNER_UNAVAILABLE', ...avala, scored },
        'lead backfill: default owner not configured or not a CRM user; owners and first-contact tasks skipped, will retry on next start',
      )
      return
    }

    const plan = planOwnersAndTasks(await liveLeadRows(tx), defaultOwnerId)
    await applyOwnersAndTasks(tx, plan)

    const summary = {
      avala_attributions: avala.attributions,
      avala_notes: avala.notes,
      leads_scored: scored,
      owners_set: plan.ownerUpdates.size,
      first_contact_tasks: plan.tasks.length,
    }
    await tx.insert(dataBackfills).values({ name: LEAD_INTAKE_BACKFILL_NAME, summary })
    logger.info(summary, 'lead backfill applied')
  })
}

import { FIRST_CONTACT_TITLE_PREFIX } from '@/lib/webhooks/first-contact'
import {
  activities,
  cases,
  contacts,
  conversions,
  engagements,
  leads,
  notes,
  opportunities,
  orders,
  quotes,
  webhookEvents,
} from '@phynd/db/schema'
import type { ServiceContext } from '@phynd/services'
import { and, eq, isNull, like, notInArray, sql } from 'drizzle-orm'
import { AVALA_SERVICE_ACTOR } from './avala-lead-context'

// `avala.lead.deleted`: Avala deleted a lead, so the CRM removes its copy with
// the CRM's own deletion semantics. For every CRM lead created from that
// Avala lead (matched by `avala_lead_id` on its `visitor_to_lead` conversion):
//   - the lead is soft-deleted (`deleted_at`, as every CRM delete);
//   - the notes the Avala receiver wrote on it (the prospect's message) and
//     its still-pending first-contact task (its title names the prospect)
//     are deleted; staff work on the lead stays with the deleted lead;
//   - the contact is soft-deleted too, unless something else keeps it: another
//     live lead, an opportunity, quote, order, engagement or case, a linked
//     Janua account, or a customer stage;
//   - the raw `avala.lead.captured` record in `webhook_events` keeps only its
//     envelope (event id for deduplication, type, times) and the Avala lead id.
// Running it again changes nothing.

export interface AvalaLeadDeletionStore {
  /** Live CRM leads created from the Avala lead, with their contact. */
  findLiveLeads(avalaLeadId: string): Promise<Array<{ leadId: string; contactId: string | null }>>
  deleteIntakeNotes(leadId: string): Promise<number>
  deletePendingFirstContactTasks(leadId: string): Promise<number>
  softDeleteLead(leadId: string): Promise<void>
  /** True when anything other than `deletedLeadIds` keeps the contact. */
  contactIsKept(contactId: string, deletedLeadIds: string[]): Promise<boolean>
  softDeleteContact(contactId: string): Promise<void>
  /** Strips the prospect's data from the stored capture events; returns how many. */
  redactCaptureEvents(avalaLeadId: string): Promise<number>
}

export interface AvalaLeadDeletionResult {
  leadsDeleted: number
  contactsDeleted: number
  contactsKept: number
  notesDeleted: number
  tasksDeleted: number
  eventsRedacted: number
}

export async function propagateAvalaLeadDeletion(
  store: AvalaLeadDeletionStore,
  avalaLeadId: string,
): Promise<AvalaLeadDeletionResult> {
  const found = await store.findLiveLeads(avalaLeadId)
  const result: AvalaLeadDeletionResult = {
    leadsDeleted: 0,
    contactsDeleted: 0,
    contactsKept: 0,
    notesDeleted: 0,
    tasksDeleted: 0,
    eventsRedacted: 0,
  }

  for (const { leadId } of found) {
    result.notesDeleted += await store.deleteIntakeNotes(leadId)
    result.tasksDeleted += await store.deletePendingFirstContactTasks(leadId)
    await store.softDeleteLead(leadId)
    result.leadsDeleted += 1
  }

  const deletedLeadIds = found.map((row) => row.leadId)
  const contactIds = [
    ...new Set(found.map((row) => row.contactId).filter((id): id is string => id !== null)),
  ]
  for (const contactId of contactIds) {
    if (await store.contactIsKept(contactId, deletedLeadIds)) {
      result.contactsKept += 1
    } else {
      await store.softDeleteContact(contactId)
      result.contactsDeleted += 1
    }
  }

  result.eventsRedacted = await store.redactCaptureEvents(avalaLeadId)
  return result
}

/** The store on the CRM's tables. `ctx.db` should be a transaction. */
export function createAvalaLeadDeletionStore(ctx: ServiceContext): AvalaLeadDeletionStore {
  const db = ctx.db

  async function exists(query: Promise<unknown[]>): Promise<boolean> {
    return (await query).length > 0
  }

  return {
    async findLiveLeads(avalaLeadId) {
      return db
        .select({ leadId: leads.id, contactId: leads.contactId })
        .from(conversions)
        .innerJoin(leads, eq(leads.id, conversions.leadId))
        .where(
          and(
            eq(conversions.type, 'visitor_to_lead'),
            sql`${conversions.metadata} ->> 'avala_lead_id' = ${avalaLeadId}`,
            isNull(leads.deletedAt),
          ),
        )
    },

    async deleteIntakeNotes(leadId) {
      const rows = await db
        .delete(notes)
        .where(
          and(
            eq(notes.entityType, 'lead'),
            eq(notes.entityId, leadId),
            eq(notes.authorId, AVALA_SERVICE_ACTOR),
          ),
        )
        .returning({ id: notes.id })
      return rows.length
    },

    async deletePendingFirstContactTasks(leadId) {
      const rows = await db
        .delete(activities)
        .where(
          and(
            eq(activities.entityType, 'lead'),
            eq(activities.entityId, leadId),
            eq(activities.type, 'task'),
            eq(activities.status, 'pending'),
            like(activities.title, `${FIRST_CONTACT_TITLE_PREFIX}:%`),
          ),
        )
        .returning({ id: activities.id })
      return rows.length
    },

    async softDeleteLead(leadId) {
      await db.update(leads).set({ deletedAt: new Date() }).where(eq(leads.id, leadId))
    },

    async contactIsKept(contactId, deletedLeadIds) {
      const [contact] = await db
        .select({
          externalJanuaId: contacts.externalJanuaId,
          lifecycleStage: contacts.lifecycleStage,
          deletedAt: contacts.deletedAt,
        })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1)
      // Already gone: nothing to delete.
      if (!contact || contact.deletedAt) return true
      if (contact.externalJanuaId || contact.lifecycleStage !== 'lead') return true

      const otherLeads = deletedLeadIds.length
        ? and(
            eq(leads.contactId, contactId),
            isNull(leads.deletedAt),
            notInArray(leads.id, deletedLeadIds),
          )
        : and(eq(leads.contactId, contactId), isNull(leads.deletedAt))
      const checks = [
        db.select({ id: leads.id }).from(leads).where(otherLeads).limit(1),
        db
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(and(eq(opportunities.contactId, contactId), isNull(opportunities.deletedAt)))
          .limit(1),
        db
          .select({ id: quotes.id })
          .from(quotes)
          .where(and(eq(quotes.contactId, contactId), isNull(quotes.deletedAt)))
          .limit(1),
        db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.contactId, contactId), isNull(orders.deletedAt)))
          .limit(1),
        db
          .select({ id: engagements.id })
          .from(engagements)
          .where(and(eq(engagements.contactId, contactId), isNull(engagements.deletedAt)))
          .limit(1),
        db.select({ id: cases.id }).from(cases).where(eq(cases.contactId, contactId)).limit(1),
      ]
      for (const check of checks) {
        if (await exists(check)) return true
      }
      return false
    },

    async softDeleteContact(contactId) {
      await db.update(contacts).set({ deletedAt: new Date() }).where(eq(contacts.id, contactId))
    },

    async redactCaptureEvents(avalaLeadId) {
      const rows = await db
        .update(webhookEvents)
        .set({
          payload: sql`jsonb_build_object(
            'schema_version', ${webhookEvents.payload} -> 'schema_version',
            'event_id', ${webhookEvents.payload} -> 'event_id',
            'event_type', ${webhookEvents.payload} -> 'event_type',
            'source', ${webhookEvents.payload} -> 'source',
            'occurred_at', ${webhookEvents.payload} -> 'occurred_at',
            'aggregate', ${webhookEvents.payload} -> 'aggregate',
            'payload', jsonb_build_object('lead', jsonb_build_object('id', ${avalaLeadId}::text)),
            'redacted', true
          )`,
        })
        .where(
          and(
            eq(webhookEvents.provider, 'avala'),
            eq(webhookEvents.eventType, 'avala.lead.captured'),
            sql`${webhookEvents.payload} -> 'payload' -> 'lead' ->> 'id' = ${avalaLeadId}`,
            sql`coalesce((${webhookEvents.payload} ->> 'redacted')::boolean, false) = false`,
          ),
        )
        .returning({ id: webhookEvents.id })
      return rows.length
    },
  }
}

import { describe, expect, it, vi } from 'vitest'

vi.mock('@phynd/services', () => ({}))
vi.mock('@phynd/db/schema', () => ({}))

import { type AvalaLeadDeletionStore, propagateAvalaLeadDeletion } from '../avala-lead-deletion'

/**
 * In-memory store: CRM leads with the Avala lead they came from, the contacts
 * that keep themselves for another reason, intake notes and pending tasks per
 * lead, and stored capture events per Avala lead.
 */
function fakeStore(input: {
  leads: Array<{ leadId: string; contactId: string | null; avalaLeadId: string }>
  keptContacts?: string[]
  notes?: Record<string, number>
  tasks?: Record<string, number>
  captureEvents?: Record<string, number>
}) {
  const deletedLeads = new Set<string>()
  const deletedContacts = new Set<string>()
  const notes = { ...input.notes }
  const tasks = { ...input.tasks }
  const events = { ...input.captureEvents }
  const calls: string[] = []

  const store: AvalaLeadDeletionStore = {
    async findLiveLeads(avalaLeadId) {
      return input.leads
        .filter((lead) => lead.avalaLeadId === avalaLeadId && !deletedLeads.has(lead.leadId))
        .map(({ leadId, contactId }) => ({ leadId, contactId }))
    },
    async deleteIntakeNotes(leadId) {
      const count = notes[leadId] ?? 0
      notes[leadId] = 0
      return count
    },
    async deletePendingFirstContactTasks(leadId) {
      const count = tasks[leadId] ?? 0
      tasks[leadId] = 0
      return count
    },
    async softDeleteLead(leadId) {
      calls.push(`lead:${leadId}`)
      deletedLeads.add(leadId)
    },
    async contactIsKept(contactId, deletedLeadIds) {
      calls.push(`check:${contactId}:${deletedLeadIds.join(',')}`)
      if (deletedContacts.has(contactId)) return true
      return (input.keptContacts ?? []).includes(contactId)
    },
    async softDeleteContact(contactId) {
      calls.push(`contact:${contactId}`)
      deletedContacts.add(contactId)
    },
    async redactCaptureEvents(avalaLeadId) {
      const count = events[avalaLeadId] ?? 0
      events[avalaLeadId] = 0
      return count
    },
  }
  return { store, calls, deletedLeads, deletedContacts }
}

describe('propagateAvalaLeadDeletion', () => {
  it('deletes the lead, its intake note and task, the contact, and redacts the capture', async () => {
    const { store, calls } = fakeStore({
      leads: [{ leadId: 'lead-1', contactId: 'contact-1', avalaLeadId: 'avala-1' }],
      notes: { 'lead-1': 1 },
      tasks: { 'lead-1': 1 },
      captureEvents: { 'avala-1': 1 },
    })

    const result = await propagateAvalaLeadDeletion(store, 'avala-1')

    expect(result).toEqual({
      leadsDeleted: 1,
      contactsDeleted: 1,
      contactsKept: 0,
      notesDeleted: 1,
      tasksDeleted: 1,
      eventsRedacted: 1,
    })
    // The contact check excludes the lead being deleted.
    expect(calls).toEqual(['lead:lead-1', 'check:contact-1:lead-1', 'contact:contact-1'])
  })

  it('keeps a contact that something else keeps', async () => {
    const { store, deletedContacts, deletedLeads } = fakeStore({
      leads: [{ leadId: 'lead-1', contactId: 'contact-1', avalaLeadId: 'avala-1' }],
      keptContacts: ['contact-1'],
    })

    const result = await propagateAvalaLeadDeletion(store, 'avala-1')

    expect(deletedLeads.has('lead-1')).toBe(true)
    expect(deletedContacts.size).toBe(0)
    expect(result.contactsKept).toBe(1)
    expect(result.contactsDeleted).toBe(0)
  })

  it('handles several CRM leads from one Avala lead and checks each contact once', async () => {
    const { store, calls } = fakeStore({
      leads: [
        { leadId: 'lead-1', contactId: 'contact-1', avalaLeadId: 'avala-1' },
        { leadId: 'lead-2', contactId: 'contact-1', avalaLeadId: 'avala-1' },
        { leadId: 'lead-3', contactId: 'contact-3', avalaLeadId: 'avala-other' },
      ],
    })

    const result = await propagateAvalaLeadDeletion(store, 'avala-1')

    expect(result.leadsDeleted).toBe(2)
    expect(calls.filter((call) => call.startsWith('check:'))).toEqual([
      'check:contact-1:lead-1,lead-2',
    ])
    expect(calls).not.toContain('lead:lead-3')
  })

  it('is a no-op the second time', async () => {
    const { store } = fakeStore({
      leads: [{ leadId: 'lead-1', contactId: 'contact-1', avalaLeadId: 'avala-1' }],
      notes: { 'lead-1': 1 },
      captureEvents: { 'avala-1': 1 },
    })
    await propagateAvalaLeadDeletion(store, 'avala-1')

    const again = await propagateAvalaLeadDeletion(store, 'avala-1')

    expect(again).toEqual({
      leadsDeleted: 0,
      contactsDeleted: 0,
      contactsKept: 0,
      notesDeleted: 0,
      tasksDeleted: 0,
      eventsRedacted: 0,
    })
  })

  it('still redacts the stored capture when no CRM lead exists', async () => {
    const { store } = fakeStore({ leads: [], captureEvents: { 'avala-1': 1 } })
    const result = await propagateAvalaLeadDeletion(store, 'avala-1')
    expect(result.leadsDeleted).toBe(0)
    expect(result.eventsRedacted).toBe(1)
  })
})

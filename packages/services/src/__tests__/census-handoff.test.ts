import type { LeadAttribution } from '@phynd/types/crm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CensusOptOut, CensusPickHandoff } from '../census/census-event-schema'
import {
  CENSUS_ACTOR_ID,
  CENSUS_REDACTED,
  type CensusTenantStore,
  type CensusTenantTx,
  applyCensusOptOut,
  applyCensusPickHandoff,
  censusContactName,
} from '../census/census-handoff'

// ---------------------------------------------------------------------------
// In-memory tenant: one transaction at a time; what `run` writes is committed
// only when the work resolves (a throw discards all of it).
// ---------------------------------------------------------------------------

interface Tables {
  contacts: { id: string; name: string; ownerId: string | null; deleted: boolean }[]
  leads: {
    id: string
    contactId: string | null
    source: string
    attribution: LeadAttribution | null
    deleted: boolean
  }[]
  notes: { id: string; entityId: string; content: string; authorId: string }[]
  activities: {
    id: string
    entityId: string
    type: string
    title: string
    description: string
    dueAt?: Date
    status: string
    ownerId: string | null
  }[]
  links: {
    id: string
    orgId: string
    listId: string
    platform: string
    externalId: string
    leadId: string
    contactId: string | null
  }[]
  events: { eventId: string; eventType: string; summary: Record<string, string> }[]
}

function emptyTables(): Tables {
  return { contacts: [], leads: [], notes: [], activities: [], links: [], events: [] }
}

class FakeTenant implements CensusTenantStore {
  committed = emptyTables()
  hasDefaultPipeline = true
  failTask = false
  /** Advisory lock keys taken, in order (locks hold no data). */
  locks: string[] = []
  private seq = 0

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  async run<T>(work: (tx: CensusTenantTx) => Promise<T>): Promise<T> {
    const t: Tables = structuredClone(this.committed)
    const result = await work(this.tx(t))
    this.committed = t
    return result
  }

  private tx(t: Tables): CensusTenantTx {
    const toLink = (l: Tables['links'][number]) => ({
      id: l.id,
      leadId: l.leadId,
      contactId: l.contactId,
    })
    const toLead = (l: Tables['leads'][number]) => ({
      id: l.id,
      contactId: l.contactId,
      attribution: l.attribution,
    })
    return {
      lock: async (key) => {
        this.locks.push(key)
      },
      hasProcessedEvent: async (eventId) => t.events.some((e) => e.eventId === eventId),
      recordProcessedEvent: async (record) => {
        t.events.push(record)
      },
      findPickLink: async (orgId, platform, externalId) => {
        const link = t.links.find(
          (l) => l.orgId === orgId && l.platform === platform && l.externalId === externalId,
        )
        return link ? toLink(link) : null
      },
      findPickLinksForChannel: async (platform, externalId) =>
        t.links.filter((l) => l.platform === platform && l.externalId === externalId).map(toLink),
      saveLink: async (link) => {
        const existing = link.id ? t.links.find((l) => l.id === link.id) : undefined
        if (existing) Object.assign(existing, link)
        else t.links.push({ ...link, id: this.nextId('link') })
      },
      deleteLink: async (id) => {
        t.links = t.links.filter((l) => l.id !== id)
      },
      getLiveLead: async (id) => {
        const lead = t.leads.find((l) => l.id === id && !l.deleted)
        return lead ? toLead(lead) : null
      },
      getAnyLead: async (id) => {
        const lead = t.leads.find((l) => l.id === id)
        return lead ? toLead(lead) : null
      },
      getLiveContact: async (id) => t.contacts.find((c) => c.id === id && !c.deleted) ?? null,
      getAnyContact: async (id) => t.contacts.find((c) => c.id === id) ?? null,
      createContact: async ({ name }) => {
        const contact = { id: this.nextId('contact'), name, ownerId: null, deleted: false }
        t.contacts.push(contact)
        return contact
      },
      renameContact: async (id, name) => {
        const contact = t.contacts.find((c) => c.id === id)
        if (contact) contact.name = name
      },
      createLeadInDefaultPipeline: async ({ contactId, source, attribution }) => {
        if (!this.hasDefaultPipeline) return null
        const lead = { id: this.nextId('lead'), contactId, source, attribution, deleted: false }
        t.leads.push(lead)
        return { id: lead.id }
      },
      setLeadAttribution: async (leadId, attribution) => {
        const lead = t.leads.find((l) => l.id === leadId)
        if (lead) lead.attribution = attribution
      },
      addLeadNote: async (leadId, content) => {
        t.notes.push({
          id: this.nextId('note'),
          entityId: leadId,
          content,
          authorId: CENSUS_ACTOR_ID,
        })
      },
      listCensusNotes: async (leadId) =>
        t.notes
          .filter((n) => n.entityId === leadId && n.authorId === CENSUS_ACTOR_ID)
          .map((n) => ({ id: n.id, content: n.content })),
      updateNote: async (id, content) => {
        const note = t.notes.find((n) => n.id === id)
        if (note) note.content = content
      },
      openFollowUpTask: async (input) => {
        if (this.failTask) return false
        t.activities.push({
          id: this.nextId('activity'),
          entityId: input.leadId,
          type: 'task',
          title: input.title,
          description: input.description,
          dueAt: input.dueAt,
          status: 'pending',
          ownerId: input.contactOwnerId ?? 'default-owner',
        })
        return true
      },
      recordLeadActivity: async (input) => {
        t.activities.push({
          id: this.nextId('activity'),
          entityId: input.leadId,
          type: 'note',
          title: input.title,
          description: input.description,
          status: 'completed',
          ownerId: null,
        })
      },
    }
  }
}

// Synthetic values only.
const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const CHANNEL_URL = `https://www.youtube.com/channel/${CHANNEL}`
const NOW = new Date('2026-11-24T18:00:00Z') // a Tuesday

function pick(overrides: Partial<CensusPickHandoff> = {}): CensusPickHandoff {
  return {
    eventId: '00000000-0000-4000-8000-000000000001',
    orgId: 'org_test_agency',
    listId: 'list_test_1',
    listName: 'Lista de prueba',
    platform: 'youtube',
    externalId: CHANNEL,
    channelUrl: CHANNEL_URL,
    stage: 'shortlisted',
    handedOffBy: 'user_test_1',
    note: `Buen canal, ver ${CHANNEL_URL}`,
    occurredAt: '2026-11-24T17:00:00Z',
    ...overrides,
  }
}

function optOut(overrides: Partial<CensusOptOut> = {}): CensusOptOut {
  return {
    eventId: '00000000-0000-4000-8000-00000000000f',
    platform: 'youtube',
    externalId: CHANNEL,
    observedAt: '2026-11-26T09:00:00Z',
    ...overrides,
  }
}

let tenant: FakeTenant

beforeEach(() => {
  tenant = new FakeTenant()
})

describe('applyCensusPickHandoff', () => {
  it('creates a contact, a lead, the agency note and a follow-up task', async () => {
    expect(await applyCensusPickHandoff(tenant, pick(), NOW)).toBe('created')
    const { contacts, leads, notes, activities, links, events } = tenant.committed

    expect(contacts).toEqual([
      { id: expect.any(String), name: `YouTube · ${CHANNEL}`, ownerId: null, deleted: false },
    ])
    expect(leads).toHaveLength(1)
    expect(leads[0]).toMatchObject({
      contactId: contacts[0]?.id,
      source: 'creator-census',
      attribution: {
        census: {
          org_id: 'org_test_agency',
          list_id: 'list_test_1',
          list_name: 'Lista de prueba',
          stage: 'shortlisted',
          platform: 'youtube',
          external_id: CHANNEL,
          channel_url: CHANNEL_URL,
          event_id: pick().eventId,
          handed_off_at: '2026-11-24T17:00:00Z',
        },
      },
    })
    // handed_off_by is not kept on the lead.
    expect(JSON.stringify(leads[0]?.attribution)).not.toContain('user_test_1')

    expect(notes).toEqual([
      {
        id: expect.any(String),
        entityId: leads[0]?.id,
        authorId: CENSUS_ACTOR_ID,
        content: `Nota de la agencia (lista «Lista de prueba» del censo de creadores):\n\nBuen canal, ver ${CHANNEL_URL}`,
      },
    ])

    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      entityId: leads[0]?.id,
      type: 'task',
      title: 'Dar seguimiento: selección del censo «Lista de prueba»',
      status: 'pending',
    })
    // Next business day, 09:00 Mexico City.
    expect(activities[0]?.dueAt?.toISOString()).toBe('2026-11-25T15:00:00.000Z')
    // The task title never carries the channel id.
    expect(activities[0]?.title).not.toContain(CHANNEL)

    expect(links).toEqual([
      expect.objectContaining({
        orgId: 'org_test_agency',
        leadId: leads[0]?.id,
        contactId: contacts[0]?.id,
      }),
    ])
    // The processed-event record holds no channel id or URL.
    expect(events).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain(CHANNEL)
  })

  it('creates no note when the agency wrote none', async () => {
    await applyCensusPickHandoff(tenant, pick({ note: null }), NOW)
    expect(tenant.committed.notes).toEqual([])
    expect(tenant.committed.leads).toHaveLength(1)
  })

  it('a redelivery of the same event creates nothing new', async () => {
    await applyCensusPickHandoff(tenant, pick(), NOW)
    const before = structuredClone(tenant.committed)
    expect(await applyCensusPickHandoff(tenant, pick(), NOW)).toBe('duplicate')
    expect(tenant.committed.contacts).toEqual(before.contacts)
    expect(tenant.committed.leads).toEqual(before.leads)
    expect(tenant.committed.notes).toEqual(before.notes)
    expect(tenant.committed.activities).toEqual(before.activities)
    expect(tenant.committed.events).toEqual(before.events)
  })

  it('a second hand-off of the channel by the same org updates the stage of the same lead', async () => {
    await applyCensusPickHandoff(tenant, pick(), NOW)
    const second = pick({
      eventId: '00000000-0000-4000-8000-000000000002',
      stage: 'in_talks',
      note: 'Ya respondió',
      occurredAt: '2026-11-25T17:00:00Z',
    })
    expect(await applyCensusPickHandoff(tenant, second, NOW)).toBe('updated')

    const { contacts, leads, notes, activities, links } = tenant.committed
    expect(contacts).toHaveLength(1)
    expect(leads).toHaveLength(1)
    expect(links).toHaveLength(1)
    expect(leads[0]?.attribution?.census).toMatchObject({
      stage: 'in_talks',
      event_id: second.eventId,
      handed_off_at: '2026-11-25T17:00:00Z',
    })
    expect(notes).toHaveLength(2)
    // One follow-up task (from the first hand-off) and one stage-change entry.
    expect(activities.map((a) => [a.type, a.title])).toEqual([
      ['task', 'Dar seguimiento: selección del censo «Lista de prueba»'],
      ['note', 'Etapa en el censo: preseleccionado → en conversación'],
    ])
  })

  it('an older hand-off delivered late never moves the stage back', async () => {
    await applyCensusPickHandoff(
      tenant,
      pick({ stage: 'allied', occurredAt: '2026-11-25T17:00:00Z', note: null }),
      NOW,
    )
    const late = pick({
      eventId: '00000000-0000-4000-8000-000000000003',
      stage: 'approached',
      occurredAt: '2026-11-24T10:00:00Z',
      note: null,
    })
    expect(await applyCensusPickHandoff(tenant, late, NOW)).toBe('updated')
    expect(tenant.committed.leads[0]?.attribution?.census?.stage).toBe('allied')
    expect(tenant.committed.activities.filter((a) => a.type === 'note')).toEqual([])
    // Still recorded, so a redelivery of it is a duplicate.
    expect(await applyCensusPickHandoff(tenant, late, NOW)).toBe('duplicate')
  })

  it('a hand-off of the same channel by another org opens its own lead', async () => {
    await applyCensusPickHandoff(tenant, pick(), NOW)
    await applyCensusPickHandoff(
      tenant,
      pick({ eventId: '00000000-0000-4000-8000-000000000004', orgId: 'org_other_agency' }),
      NOW,
    )
    expect(tenant.committed.leads).toHaveLength(2)
    expect(tenant.committed.links).toHaveLength(2)
  })

  it('opens a new lead on the same contact when staff deleted the earlier one', async () => {
    await applyCensusPickHandoff(tenant, pick(), NOW)
    const first = tenant.committed.leads[0]
    if (first) first.deleted = true
    await applyCensusPickHandoff(
      tenant,
      pick({ eventId: '00000000-0000-4000-8000-000000000005', stage: 'approached' }),
      NOW,
    )
    const { contacts, leads, links } = tenant.committed
    expect(contacts).toHaveLength(1)
    expect(leads).toHaveLength(2)
    expect(leads[1]?.contactId).toBe(contacts[0]?.id)
    expect(links).toEqual([expect.objectContaining({ leadId: leads[1]?.id })])
  })

  it('writes nothing when the tenant has no default pipeline (the event is retried)', async () => {
    tenant.hasDefaultPipeline = false
    await expect(applyCensusPickHandoff(tenant, pick(), NOW)).rejects.toThrow(/default pipeline/)
    expect(tenant.committed).toEqual(emptyTables())
  })

  it('keeps the lead when the follow-up task cannot be created', async () => {
    tenant.failTask = true
    expect(await applyCensusPickHandoff(tenant, pick(), NOW)).toBe('created')
    expect(tenant.committed.leads).toHaveLength(1)
    expect(tenant.committed.activities).toEqual([])
  })

  it('takes the event lock before the channel lock', async () => {
    await applyCensusPickHandoff(tenant, pick(), NOW)
    expect(tenant.locks).toEqual([
      `phynd:census:event:${pick().eventId}`,
      `phynd:census:channel:youtube:${CHANNEL}`,
    ])
  })
})

describe('applyCensusOptOut', () => {
  it('removes the census identifiers and keeps the agency work', async () => {
    await applyCensusPickHandoff(tenant, pick(), NOW)
    // Staff work on the lead that is not census data.
    tenant.committed.notes.push({
      id: 'staff-note',
      entityId: tenant.committed.leads[0]?.id ?? '',
      content: 'Llamada agendada',
      authorId: 'crm-user-1',
    })

    expect(await applyCensusOptOut(tenant, optOut())).toBe(1)
    const { contacts, leads, notes, activities, links } = tenant.committed

    expect(links).toEqual([])
    expect(leads).toHaveLength(1)
    expect(leads[0]?.attribution?.census).toEqual({
      org_id: 'org_test_agency',
      list_id: 'list_test_1',
      list_name: 'Lista de prueba',
      stage: 'shortlisted',
      event_id: pick().eventId,
      handed_off_at: '2026-11-24T17:00:00Z',
      opted_out_at: '2026-11-26T09:00:00Z',
    })
    expect(contacts[0]?.name).toBe('YouTube · canal retirado del censo')
    expect(notes.find((n) => n.authorId === CENSUS_ACTOR_ID)?.content).toBe(
      `Nota de la agencia (lista «Lista de prueba» del censo de creadores):\n\nBuen canal, ver ${CENSUS_REDACTED}`,
    )
    expect(notes.find((n) => n.id === 'staff-note')?.content).toBe('Llamada agendada')
    expect(activities.at(-1)).toMatchObject({
      type: 'note',
      title: 'Canal retirado del censo de creadores',
      status: 'completed',
    })
    // Nothing anywhere still holds the channel id.
    expect(JSON.stringify(tenant.committed)).not.toContain(CHANNEL)
  })

  it('keeps a contact name staff chose', async () => {
    await applyCensusPickHandoff(tenant, pick(), NOW)
    const contact = tenant.committed.contacts[0]
    if (contact) contact.name = 'Nombre que puso el equipo'
    await applyCensusOptOut(tenant, optOut())
    expect(tenant.committed.contacts[0]?.name).toBe('Nombre que puso el equipo')
  })

  it('also purges soft-deleted leads and contacts, for every org', async () => {
    await applyCensusPickHandoff(tenant, pick(), NOW)
    await applyCensusPickHandoff(
      tenant,
      pick({ eventId: '00000000-0000-4000-8000-000000000006', orgId: 'org_other_agency' }),
      NOW,
    )
    for (const lead of tenant.committed.leads) lead.deleted = true
    for (const contact of tenant.committed.contacts) contact.deleted = true

    expect(await applyCensusOptOut(tenant, optOut())).toBe(2)
    expect(JSON.stringify(tenant.committed)).not.toContain(CHANNEL)
  })

  it('is idempotent and leaves other channels alone', async () => {
    await applyCensusPickHandoff(tenant, pick(), NOW)
    const other = 'UCbbbbbbbbbbbbbbbbbbbbbb'
    await applyCensusPickHandoff(
      tenant,
      pick({
        eventId: '00000000-0000-4000-8000-000000000007',
        externalId: other,
        channelUrl: `https://www.youtube.com/channel/${other}`,
        note: null,
      }),
      NOW,
    )
    await applyCensusOptOut(tenant, optOut())
    const after = structuredClone(tenant.committed)
    expect(await applyCensusOptOut(tenant, optOut())).toBe(0)
    expect(tenant.committed.activities).toEqual(after.activities)
    expect(tenant.committed.links).toHaveLength(1)
    expect(tenant.committed.contacts.map((c) => c.name)).toContain(
      censusContactName('youtube', other),
    )
  })

  it('changes nothing for a channel that was never handed off', async () => {
    expect(await applyCensusOptOut(tenant, optOut())).toBe(0)
    expect(tenant.committed.activities).toEqual([])
  })
})

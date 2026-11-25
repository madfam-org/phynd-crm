import type { LeadAttribution, LeadCensusAttribution } from '@phynd/types/crm'
import { nextBusinessDayDueAt } from '../tasks/follow-up-due'
import type {
  CensusOptOut,
  CensusPickHandoff,
  CensusPickPlatform,
  CensusPickStage,
} from './census-event-schema'
import { CENSUS_PICK_HANDED_OFF } from './census-event-schema'

/**
 * What a creator-census event does to one CRM tenant, written against
 * {@link CensusTenantStore} so the rules can be read (and tested) apart from
 * the database. `createCensusTenantStore` is the implementation on the CRM's
 * services and tables.
 *
 * Data held per pick:
 *   - a contact named from the platform and channel id (the census sends no
 *     title or handle);
 *   - a lead with source `creator-census` whose `attribution.census` carries
 *     the organization, list, list name, stage, channel id and URL and the
 *     last event applied;
 *   - an `external_references` row (provider `creator-census`, type
 *     `census_pick`, external id `<platform>:<channel id>`, metadata
 *     `{ org_id, list_id, contact_id }`) that finds the lead again for the next
 *     hand-off of the same channel by the same organization, and for an
 *     opt-out;
 *   - the agency's note, as a note on the lead written by the system;
 *   - one follow-up task;
 *   - a `webhook_events` row per applied event (provider `creator-census`)
 *     holding the event id, list id, stage and time only, never a channel id.
 */

export const CENSUS_LEAD_SOURCE = 'creator-census'
/** `webhook_events.provider` and `external_references.provider`. */
export const CENSUS_PROVIDER = 'creator-census'
export const CENSUS_LINK_TYPE = 'census_pick'
/** The principal the consumer writes as (`notes.author_id` of its notes). */
export const CENSUS_ACTOR_ID = 'service:creator-census'

const PLATFORM_LABEL: Record<CensusPickPlatform, string> = { youtube: 'YouTube' }

export const CENSUS_STAGE_LABEL: Record<CensusPickStage, string> = {
  shortlisted: 'preseleccionado',
  approached: 'contactado',
  in_talks: 'en conversación',
  allied: 'aliado',
  passed: 'descartado',
}

/** Written over a channel id or URL in a census note after an opt-out. */
export const CENSUS_REDACTED = '[retirado del censo]'

/** `activities.title` is varchar(255). */
const TITLE_MAX = 255

export interface CensusPickLink {
  id: string
  leadId: string
  contactId: string | null
}

export interface CensusLeadRecord {
  id: string
  contactId: string | null
  attribution: LeadAttribution | null
}

export interface CensusContactRecord {
  id: string
  name: string
  ownerId: string | null
}

/** The operations one tenant offers, all inside the transaction `run` opens. */
export interface CensusTenantTx {
  /** Transaction-scoped advisory lock on `key`. */
  lock(key: string): Promise<void>
  hasProcessedEvent(eventId: string): Promise<boolean>
  recordProcessedEvent(record: {
    eventId: string
    eventType: string
    summary: Record<string, string>
  }): Promise<void>
  findPickLink(orgId: string, platform: string, externalId: string): Promise<CensusPickLink | null>
  findPickLinksForChannel(platform: string, externalId: string): Promise<CensusPickLink[]>
  saveLink(link: {
    id?: string
    orgId: string
    listId: string
    platform: string
    externalId: string
    leadId: string
    contactId: string | null
  }): Promise<void>
  deleteLink(id: string): Promise<void>
  /** A lead that is not soft-deleted, or null. */
  getLiveLead(id: string): Promise<CensusLeadRecord | null>
  /** A lead in any state (a purge also reaches soft-deleted rows). */
  getAnyLead(id: string): Promise<CensusLeadRecord | null>
  getLiveContact(id: string): Promise<CensusContactRecord | null>
  getAnyContact(id: string): Promise<CensusContactRecord | null>
  createContact(input: { name: string }): Promise<CensusContactRecord>
  renameContact(id: string, name: string): Promise<void>
  /** A lead in the default pipeline's first stage, or null when there is none. */
  createLeadInDefaultPipeline(input: {
    contactId: string
    source: string
    attribution: LeadAttribution
  }): Promise<{ id: string } | null>
  setLeadAttribution(leadId: string, attribution: LeadAttribution | null): Promise<void>
  addLeadNote(leadId: string, content: string): Promise<void>
  /** Notes on the lead written by {@link CENSUS_ACTOR_ID}. */
  listCensusNotes(leadId: string): Promise<{ id: string; content: string }[]>
  updateNote(id: string, content: string): Promise<void>
  /**
   * The follow-up task, best effort (in a savepoint): owned by the contact's
   * owner, else the configured default task owner, else unassigned. Returns
   * whether it was created.
   */
  openFollowUpTask(input: {
    leadId: string
    contactOwnerId: string | null
    title: string
    description: string
    dueAt: Date
  }): Promise<boolean>
  /** A finished activity on the lead's timeline (type `note`, no owner). */
  recordLeadActivity(input: { leadId: string; title: string; description: string }): Promise<void>
}

export interface CensusTenantStore {
  run<T>(work: (tx: CensusTenantTx) => Promise<T>): Promise<T>
}

export type CensusPickOutcome = 'created' | 'updated' | 'duplicate'

export class CensusHandoffError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CensusHandoffError'
  }
}

function cut(value: string, max: number): string {
  return Array.from(value).length > max ? Array.from(value).slice(0, max).join('') : value
}

/**
 * The contact's name: no title or handle is sent, so it is the platform and
 * the channel id, e.g. `YouTube · UC…`. Staff may rename it; an opt-out
 * replaces it only while it is still this name.
 */
export function censusContactName(platform: CensusPickPlatform, externalId: string): string {
  return `${PLATFORM_LABEL[platform]} · ${externalId}`
}

export function censusOptedOutContactName(platform: string): string {
  const label = PLATFORM_LABEL[platform as CensusPickPlatform] ?? platform
  return `${label} · canal retirado del censo`
}

function pickAttribution(event: CensusPickHandoff): LeadCensusAttribution {
  return {
    org_id: event.orgId,
    list_id: event.listId,
    list_name: event.listName,
    stage: event.stage,
    platform: event.platform,
    external_id: event.externalId,
    channel_url: event.channelUrl,
    event_id: event.eventId,
    handed_off_at: event.occurredAt,
  }
}

/** The agency's note, labelled as coming from its census list. */
export function censusNoteContent(listName: string, note: string): string {
  return `Nota de la agencia (lista «${listName}» del censo de creadores):\n\n${note}`
}

/** Exactly-once per `event_id`; a second hand-off of a channel updates its lead. */
export async function applyCensusPickHandoff(
  store: CensusTenantStore,
  event: CensusPickHandoff,
  now: Date = new Date(),
): Promise<CensusPickOutcome> {
  return store.run(async (tx) => {
    // Event lock first, channel lock second, always in that order (the
    // opt-out takes only the channel lock).
    await tx.lock(`phynd:census:event:${event.eventId}`)
    if (await tx.hasProcessedEvent(event.eventId)) return 'duplicate'
    await tx.lock(channelLockKey(event.platform, event.externalId))

    const link = await tx.findPickLink(event.orgId, event.platform, event.externalId)
    const lead = link ? await tx.getLiveLead(link.leadId) : null
    const outcome =
      lead && link
        ? await updatePick(tx, link, lead, event)
        : await createPick(tx, link, event, now)

    await tx.recordProcessedEvent({
      eventId: event.eventId,
      eventType: CENSUS_PICK_HANDED_OFF,
      summary: {
        event_id: event.eventId,
        list_id: event.listId,
        stage: event.stage,
        occurred_at: event.occurredAt,
      },
    })
    return outcome
  })
}

function channelLockKey(platform: string, externalId: string): string {
  return `phynd:census:channel:${platform}:${externalId}`
}

async function createPick(
  tx: CensusTenantTx,
  previousLink: CensusPickLink | null,
  event: CensusPickHandoff,
  now: Date,
): Promise<CensusPickOutcome> {
  // A link whose lead staff deleted: the hand-off is new intent, so a new lead
  // is opened, on the same contact while it still exists.
  const reused = previousLink?.contactId ? await tx.getLiveContact(previousLink.contactId) : null
  const contact =
    reused ??
    (await tx.createContact({ name: censusContactName(event.platform, event.externalId) }))

  const lead = await tx.createLeadInDefaultPipeline({
    contactId: contact.id,
    source: CENSUS_LEAD_SOURCE,
    attribution: { census: pickAttribution(event) },
  })
  // Without a default pipeline there is nowhere to put the lead; failing makes
  // the consumer retry and then dead-letter the event, where it is visible.
  if (!lead) throw new CensusHandoffError('no default pipeline with a stage in this tenant')

  await tx.saveLink({
    id: previousLink?.id,
    orgId: event.orgId,
    listId: event.listId,
    platform: event.platform,
    externalId: event.externalId,
    leadId: lead.id,
    contactId: contact.id,
  })

  if (event.note) await tx.addLeadNote(lead.id, censusNoteContent(event.listName, event.note))

  await tx.openFollowUpTask({
    leadId: lead.id,
    contactOwnerId: contact.ownerId,
    title: cut(`Dar seguimiento: selección del censo «${event.listName}»`, TITLE_MAX),
    description: `Canal entregado por la agencia desde su lista «${event.listName}» del censo de creadores (etapa: ${CENSUS_STAGE_LABEL[event.stage]}).`,
    dueAt: nextBusinessDayDueAt(now),
  })
  return 'created'
}

async function updatePick(
  tx: CensusTenantTx,
  link: CensusPickLink,
  lead: CensusLeadRecord,
  event: CensusPickHandoff,
): Promise<CensusPickOutcome> {
  const previous = lead.attribution?.census
  // An older hand-off delivered after a newer one never moves the stage back.
  const isNewer =
    !previous?.handed_off_at || Date.parse(event.occurredAt) >= Date.parse(previous.handed_off_at)

  if (isNewer) {
    await tx.setLeadAttribution(lead.id, {
      ...(lead.attribution ?? {}),
      census: pickAttribution(event),
    })
    await tx.saveLink({
      id: link.id,
      orgId: event.orgId,
      listId: event.listId,
      platform: event.platform,
      externalId: event.externalId,
      leadId: lead.id,
      contactId: link.contactId ?? lead.contactId,
    })
    const from = previous?.stage as CensusPickStage | undefined
    if (from !== event.stage) {
      const fromLabel = from && CENSUS_STAGE_LABEL[from] ? CENSUS_STAGE_LABEL[from] : 'sin etapa'
      await tx.recordLeadActivity({
        leadId: lead.id,
        title: cut(
          `Etapa en el censo: ${fromLabel} → ${CENSUS_STAGE_LABEL[event.stage]}`,
          TITLE_MAX,
        ),
        description: `La agencia volvió a entregar el canal desde su lista «${event.listName}».`,
      })
    }
  }

  if (event.note) await tx.addLeadNote(lead.id, censusNoteContent(event.listName, event.note))
  return 'updated'
}

/**
 * `census.optout.completed`: the CRM stops holding census-derived identifiers
 * for the channel. For every pick link of the channel in this tenant: the
 * channel id and URL leave the lead's attribution (which keeps the list,
 * stage and the time of the opt-out), the channel id and URL are redacted in
 * the census notes, the contact loses the name derived from the channel id
 * (unless staff renamed it), the link is deleted and an activity records it.
 * The lead, its staff notes and tasks stay: they are the agency's own work,
 * not census data. Soft-deleted leads and contacts are purged too, since a
 * soft delete keeps the row. Running it again finds no link and changes
 * nothing. Returns the number of links purged.
 */
export async function applyCensusOptOut(
  store: CensusTenantStore,
  event: CensusOptOut,
): Promise<number> {
  return store.run(async (tx) => {
    await tx.lock(channelLockKey(event.platform, event.externalId))
    const links = await tx.findPickLinksForChannel(event.platform, event.externalId)

    for (const link of links) {
      const lead = await tx.getAnyLead(link.leadId)
      if (lead) await purgeLead(tx, lead, event)

      const contactId = link.contactId ?? lead?.contactId ?? null
      const contact = contactId ? await tx.getAnyContact(contactId) : null
      if (
        contact &&
        event.platform === 'youtube' &&
        contact.name === censusContactName(event.platform, event.externalId)
      ) {
        await tx.renameContact(contact.id, censusOptedOutContactName(event.platform))
      }
      await tx.deleteLink(link.id)
    }
    return links.length
  })
}

async function purgeLead(
  tx: CensusTenantTx,
  lead: CensusLeadRecord,
  event: CensusOptOut,
): Promise<void> {
  const census = lead.attribution?.census
  const identifiers = [census?.channel_url, census?.external_id, event.externalId].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  )

  const { platform: _platform, external_id: _id, channel_url: _url, ...kept } = census ?? {}
  await tx.setLeadAttribution(lead.id, {
    ...(lead.attribution ?? {}),
    census: { ...kept, opted_out_at: event.observedAt },
  })

  for (const note of await tx.listCensusNotes(lead.id)) {
    const redacted = redact(note.content, identifiers)
    if (redacted !== note.content) await tx.updateNote(note.id, redacted)
  }

  await tx.recordLeadActivity({
    leadId: lead.id,
    title: 'Canal retirado del censo de creadores',
    description:
      'El creador pidió salir del censo. Se borraron del CRM el identificador del canal, su URL y el nombre de contacto derivado de ellos; la lista, la etapa, las notas del equipo y las tareas se conservan.',
  })
}

/** Every occurrence of each identifier (longest first, so a URL goes before its id). */
function redact(content: string, identifiers: string[]): string {
  return [...identifiers]
    .sort((a, b) => b.length - a.length)
    .reduce((text, identifier) => text.split(identifier).join(CENSUS_REDACTED), content)
}

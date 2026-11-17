import {
  activities,
  consentRecords,
  contacts,
  leadScores,
  leads,
  notes,
  pipelineStages,
  suppressionEntries,
  users,
  visitorPageViews,
  visitorSessions,
} from '@phynd/db/schema'
import type { LeadAttribution, LeadTier } from '@phynd/types/crm'
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { maskFreeText, maskWholeValue, shouldMaskPiiForAgent } from '../pii/mask'
import { FIRST_CONTACT_TASK_KIND } from './lead-intake-defaults'
import { emailDomain, isFreeMailAddress } from './lead-qualification'
import {
  LeadQueueService,
  type LeadScorePart,
  fullMessageFromNote,
  namedBreakdown,
} from './lead-queue.service'

// Everything the lead page shows in one read: the lead with its tier and score
// breakdown, owner and stage; the contact and its channels; the prospect's
// message; open tasks and the first-contact task; engagement from the CRM's
// own visitor sessions (pages seen before converting, return visits); consent
// and suppression; and possible duplicate contacts. Read-only.

/** Most pages listed as seen before the lead converted. */
const PAGES_BEFORE_MAX = 8
/** Most possible duplicates listed. */
const DUPLICATES_MAX = 5

export interface LeadWorkspace {
  lead: {
    id: string
    status: string
    source: string | null
    tier: LeadTier | null
    score: number | null
    createdAt: Date
    unsubscribed: boolean
    unsubscribedAt: Date | null
    attribution: LeadAttribution | null
    pipelineId: string
    stageId: string
    stageName: string | null
  }
  owner: { id: string; name: string | null; email: string } | null
  contact: {
    id: string
    name: string
    company: string | null
    email: string | null
    phone: string | null
    marketingConsent: boolean
    consentedAt: Date | null
  } | null
  masked: boolean
  /** Company facts derivable without fetching anything: the email's domain, when not free-mail. */
  company: { name: string | null; domain: string | null; freeMail: boolean | null }
  message: string | null
  breakdown: LeadScorePart[]
  scoreComputedAt: Date | null
  tasks: {
    id: string
    title: string
    kind: string | null
    status: string
    dueAt: Date | null
    ownerId: string | null
  }[]
  firstContact: { id: string; status: string; dueAt: Date | null; completedAt: Date | null } | null
  engagement: {
    sessions: number
    returnVisits: number
    totalPageViews: number
    pagesBefore: { url: string; title: string | null; viewedAt: Date }[]
  }
  consent: {
    records: { channel: string; status: string; updatedAt: Date }[]
    suppressed: { channel: string; reason: string }[]
  }
  duplicates: { id: string; name: string; reason: 'phone' | 'name' }[]
}

/** The last ten digits of a phone number, for matching across formats. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(-10) : null
}

type LeadRow = typeof leads.$inferSelect
type ContactRow = typeof contacts.$inferSelect

function pickLead(lead: LeadRow) {
  return {
    id: lead.id,
    status: lead.status,
    tier: (lead.tier as LeadTier | null) ?? null,
    score: lead.score,
    createdAt: lead.createdAt,
    unsubscribed: lead.unsubscribed,
    unsubscribedAt: lead.unsubscribedAt,
    pipelineId: lead.pipelineId,
    stageId: lead.stageId,
  }
}

function pickContact(contact: ContactRow) {
  return {
    id: contact.id,
    name: contact.name,
    company: contact.company,
    email: contact.email,
    phone: contact.phone,
    marketingConsent: contact.marketingConsent,
    consentedAt: contact.consentedAt,
  }
}

/** Company facts the CRM already holds: the name, and the email domain when it is not free-mail. */
function companyFacts(contact: ContactRow | null, mask: boolean) {
  const freeMail = isFreeMailAddress(contact?.email)
  return {
    name: mask ? maskWholeValue(contact?.company) : (contact?.company ?? null),
    domain: mask || freeMail !== false ? null : emailDomain(contact?.email),
    freeMail,
  }
}

interface TaskRow {
  id: string
  title: string
  kind: string | null
  status: string
  dueAt: Date | null
  ownerId: string | null
  completedAt: Date | null
}

/** Open tasks (titles masked for an agent) and the first-contact task, whatever its status. */
function taskParts(tasks: TaskRow[], mask: boolean) {
  const first = tasks.find((task) => task.kind === FIRST_CONTACT_TASK_KIND) ?? null
  return {
    tasks: tasks
      .filter((task) => task.status === 'pending')
      .map(({ completedAt: _completedAt, ...task }) => ({
        ...task,
        title: mask ? (maskFreeText(task.title) ?? '') : task.title,
      })),
    firstContact: first
      ? { id: first.id, status: first.status, dueAt: first.dueAt, completedAt: first.completedAt }
      : null,
  }
}

export class LeadWorkspaceService {
  constructor(private readonly ctx: ServiceContext) {}

  async get(leadId: string): Promise<LeadWorkspace | null> {
    const db = this.ctx.db
    const [row] = await db
      .select({
        lead: leads,
        stageName: pipelineStages.name,
        ownerName: users.name,
        ownerEmail: users.email,
        contact: contacts,
        breakdown: leadScores.breakdown,
        scoreComputedAt: leadScores.computedAt,
      })
      .from(leads)
      .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .leftJoin(users, eq(users.id, leads.ownerId))
      .leftJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(leadScores, eq(leadScores.leadId, leads.id))
      .where(and(eq(leads.id, leadId), isNull(leads.deletedAt)))
      .limit(1)
    if (!row) return null

    const { lead, contact } = row
    const mask = shouldMaskPiiForAgent(this.ctx.auth)
    const [ruleNames, tasks, note, engagement, consent, duplicates] = await Promise.all([
      new LeadQueueService(this.ctx).ruleNames(),
      this.tasks(lead.id),
      this.leadNote(contact?.id ?? null, lead.createdAt),
      this.engagement(contact?.id ?? null, lead.createdAt),
      this.consent(contact?.id ?? null, contact?.email ?? null),
      this.duplicates(contact),
    ])
    const message = fullMessageFromNote(note)

    return {
      lead: {
        ...pickLead(lead),
        source: mask ? maskWholeValue(lead.source) : lead.source,
        attribution: mask ? null : (lead.attribution ?? null),
        stageName: row.stageName,
      },
      owner: lead.ownerId
        ? { id: lead.ownerId, name: row.ownerName, email: row.ownerEmail ?? '' }
        : null,
      contact: contact ? maskedContact(pickContact(contact), mask) : null,
      masked: mask,
      company: companyFacts(contact, mask),
      message: mask ? maskFreeText(message) : message,
      breakdown: namedBreakdown(row.breakdown, ruleNames),
      scoreComputedAt: row.scoreComputedAt ?? null,
      ...taskParts(tasks, mask),
      engagement: mask ? { ...engagement, pagesBefore: [] } : engagement,
      consent,
      duplicates: mask ? [] : duplicates,
    }
  }

  /** The lead's tasks, soonest due first. */
  private tasks(leadId: string) {
    return this.ctx.db
      .select({
        id: activities.id,
        title: activities.title,
        kind: activities.kind,
        status: activities.status,
        dueAt: activities.dueAt,
        ownerId: activities.ownerId,
        completedAt: activities.completedAt,
      })
      .from(activities)
      .where(
        and(
          eq(activities.entityType, 'lead'),
          eq(activities.entityId, leadId),
          eq(activities.type, 'task'),
        ),
      )
      .orderBy(asc(sql`${activities.dueAt} nulls last`), asc(activities.createdAt))
  }

  /** The contact note the feed wrote with the lead (the prospect's words), if any. */
  private async leadNote(contactId: string | null, leadCreatedAt: Date): Promise<string | null> {
    if (!contactId) return null
    const [row] = await this.ctx.db
      .select({ content: notes.content })
      .from(notes)
      .where(
        and(
          eq(notes.entityType, 'contact'),
          eq(notes.entityId, contactId),
          gte(notes.createdAt, sql`${leadCreatedAt.toISOString()}::timestamptz - interval '5 minutes'`),
        ),
      )
      .orderBy(asc(notes.createdAt))
      .limit(1)
    return row?.content ?? null
  }

  /** Sessions of the contact, return visits, and the pages it saw up to the conversion. */
  private async engagement(contactId: string | null, convertedAt: Date) {
    const empty = { sessions: 0, returnVisits: 0, totalPageViews: 0, pagesBefore: [] }
    if (!contactId) return empty
    const sessions = await this.ctx.db
      .select({ id: visitorSessions.id, pageViewCount: visitorSessions.pageViewCount })
      .from(visitorSessions)
      .where(eq(visitorSessions.contactId, contactId))
    if (sessions.length === 0) return empty
    const pagesBefore = await this.ctx.db
      .select({
        url: visitorPageViews.url,
        title: visitorPageViews.title,
        viewedAt: visitorPageViews.viewedAt,
      })
      .from(visitorPageViews)
      .where(
        and(
          inArray(
            visitorPageViews.sessionId,
            sessions.map((session) => session.id),
          ),
          lte(visitorPageViews.viewedAt, convertedAt),
        ),
      )
      .orderBy(desc(visitorPageViews.viewedAt))
      .limit(PAGES_BEFORE_MAX)
    return {
      sessions: sessions.length,
      returnVisits: Math.max(0, sessions.length - 1),
      totalPageViews: sessions.reduce((sum, session) => sum + (session.pageViewCount ?? 0), 0),
      pagesBefore,
    }
  }

  /** Channel consent records of the contact and suppression entries of its address. */
  private async consent(contactId: string | null, email: string | null) {
    const identifier = email?.trim().toLowerCase() ?? null
    const records =
      contactId || identifier
        ? await this.ctx.db
            .select({
              channel: consentRecords.channel,
              status: consentRecords.status,
              updatedAt: consentRecords.updatedAt,
            })
            .from(consentRecords)
            .where(
              or(
                contactId ? eq(consentRecords.contactId, contactId) : undefined,
                identifier ? eq(consentRecords.identifier, identifier) : undefined,
              ),
            )
            .orderBy(desc(consentRecords.updatedAt))
        : []
    const suppressed = identifier
      ? await this.ctx.db
          .select({ channel: suppressionEntries.channel, reason: suppressionEntries.reason })
          .from(suppressionEntries)
          .where(eq(suppressionEntries.identifier, identifier))
      : []
    return { records, suppressed }
  }

  /** Other live contacts with the same phone (last 10 digits) or the same name. */
  private async duplicates(contact: { id: string; name: string; phone: string | null } | null) {
    if (!contact) return []
    const key = phoneKey(contact.phone)
    const rows = await this.ctx.db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(
        and(
          ne(contacts.id, contact.id),
          isNull(contacts.deletedAt),
          or(
            sql`lower(trim(${contacts.name})) = lower(trim(${contact.name}))`,
            key
              ? sql`right(regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g'), 10) = ${key}`
              : undefined,
          ),
        ),
      )
      .limit(DUPLICATES_MAX)
    return rows.map((dup) => ({
      id: dup.id,
      name: dup.name,
      reason: key && phoneKey(dup.phone) === key ? ('phone' as const) : ('name' as const),
    }))
  }
}

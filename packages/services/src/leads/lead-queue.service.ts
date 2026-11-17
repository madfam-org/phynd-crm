import {
  activities,
  contacts,
  leadScores,
  leadScoringRules,
  leads,
  notes,
  taggables,
  tags,
  users,
} from '@phynd/db/schema'
import type { LeadTier } from '@phynd/types/crm'
import { type SQL, and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { requireCrmUserId } from '../identity/actor'
import {
  maskEmail,
  maskFreeText,
  maskPersonName,
  maskPhone,
  maskWholeValue,
  shouldMaskPiiForAgent,
} from '../pii/mask'
import { AVALA_MESSAGE_NOTE_LABEL } from './avala-lead-context'
import { FIRST_CONTACT_TASK_KIND } from './lead-intake-defaults'

// The lead work queue (`/leads`): one row per live, non-test lead with what a
// person needs to decide who to contact next: contact, tier and score
// breakdown, channel, the first line of the prospect's message, owner, the
// first-contact task and its deadline, the last activity, tags. Ordered by
// urgency: overdue first contact, then tier, then newest.

/** Saved views of the queue. Each combines with the owner and tier filters. */
export const LEAD_QUEUE_VIEWS = ['mine', 'tier_a', 'unassigned', 'overdue', 'all'] as const
export type LeadQueueView = (typeof LEAD_QUEUE_VIEWS)[number]

export const LEAD_QUEUE_PAGE_SIZE = 50

export interface LeadQueueFilters {
  view?: LeadQueueView
  /** `me`, `unassigned`, or a CRM user id. */
  owner?: string
  tier?: LeadTier
  page?: number
  pageSize?: number
  /** For tests: the instant "overdue" is measured against. */
  now?: Date
}

export interface LeadScorePart {
  rule: string
  points: number
}

export interface LeadQueueRow {
  id: string
  status: string
  source: string | null
  tier: LeadTier | null
  score: number | null
  createdAt: Date
  owner: { id: string; name: string | null; email: string } | null
  contact: {
    id: string
    name: string
    company: string | null
    email: string | null
    phone: string | null
  } | null
  /** Personal fields above are masked for this caller. */
  masked: boolean
  /** First line of the prospect's message, when the feed sent one. */
  messagePreview: string | null
  intent: string | null
  firstContact: { id: string; dueAt: Date | null; status: string; completedAt: Date | null } | null
  lastActivityAt: Date | null
  tags: { id: string; name: string; color: string | null }[]
  breakdown: LeadScorePart[]
}

export interface LeadQueuePage {
  items: LeadQueueRow[]
  total: number
  page: number
  pageSize: number
}

export type LeadQueueCounts = Record<LeadQueueView, number>

/** Longest message preview kept, in characters. */
const PREVIEW_MAX = 160

/**
 * The prospect's words from a contact note: the Avala label and the feeds'
 * «(sin mensaje)» placeholder removed, first non-empty line, cut to `max`.
 */
export function messageFromNote(
  content: string | null | undefined,
  max = PREVIEW_MAX,
): string | null {
  if (!content) return null
  let text = content
  if (text.startsWith(AVALA_MESSAGE_NOTE_LABEL)) text = text.slice(AVALA_MESSAGE_NOTE_LABEL.length)
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '' && !part.startsWith('— vía'))
  if (!line || line === '(sin mensaje)') return null
  return Array.from(line).length > max
    ? `${Array.from(line)
        .slice(0, max - 1)
        .join('')}…`
    : line
}

/** The full message of a contact note (label and origin lines removed), or null. */
export function fullMessageFromNote(content: string | null | undefined): string | null {
  if (!content) return null
  let text = content
  if (text.startsWith(AVALA_MESSAGE_NOTE_LABEL)) text = text.slice(AVALA_MESSAGE_NOTE_LABEL.length)
  const kept = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('— '))
    .join('\n')
    .trim()
  return kept === '' || kept === '(sin mensaje)' ? null : kept
}

/** Score breakdown (`lead_scores.breakdown`: rule id → points) with rule names, largest first. */
export function namedBreakdown(
  breakdown: unknown,
  ruleNames: ReadonlyMap<string, string>,
): LeadScorePart[] {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) return []
  return Object.entries(breakdown as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] !== 0)
    .map(([id, points]) => ({ rule: ruleNames.get(id) ?? 'Regla eliminada', points }))
    .sort((a, b) => b.points - a.points)
}

/** A contact's personal fields, masked for an agent principal. */
export function maskedContact<
  T extends { name: string; company: string | null; email: string | null; phone: string | null },
>(contact: T, mask: boolean): T {
  if (!mask) return contact
  return {
    ...contact,
    name: maskPersonName(contact.name),
    company: maskWholeValue(contact.company),
    email: maskEmail(contact.email),
    phone: maskPhone(contact.phone),
  }
}

function toDate(value: string | Date | null | undefined): Date | null {
  return value ? new Date(value) : null
}

interface RawQueueRow {
  id: string
  status: string
  source: string | null
  tier: string | null
  score: number | null
  attribution: unknown
  createdAt: Date
  ownerId: string | null
  ownerName: string | null
  ownerEmail: string | null
  contactId: string | null
  contactName: string | null
  contactCompany: string | null
  contactEmail: string | null
  contactPhone: string | null
  breakdown: unknown
  firstContact: {
    id: string
    due_at: string | null
    status: string
    completed_at: string | null
  } | null
  lastActivityAt: string | null
  note: string | null
}

function toQueueRow(
  row: RawQueueRow,
  mask: boolean,
  ruleNames: ReadonlyMap<string, string>,
): Omit<LeadQueueRow, 'tags'> {
  const attribution = (row.attribution ?? {}) as { intent?: unknown }
  const preview = messageFromNote(row.note)
  const fc = row.firstContact
  return {
    id: row.id,
    status: row.status,
    source: mask ? maskWholeValue(row.source) : row.source,
    tier: (row.tier as LeadTier | null) ?? null,
    score: row.score,
    createdAt: row.createdAt,
    owner: row.ownerId
      ? { id: row.ownerId, name: row.ownerName, email: row.ownerEmail ?? '' }
      : null,
    contact: row.contactId
      ? maskedContact(
          {
            id: row.contactId,
            name: row.contactName ?? '',
            company: row.contactCompany,
            email: row.contactEmail,
            phone: row.contactPhone,
          },
          mask,
        )
      : null,
    masked: mask,
    messagePreview: mask ? maskFreeText(preview) : preview,
    intent: typeof attribution.intent === 'string' ? attribution.intent : null,
    firstContact: fc
      ? {
          id: fc.id,
          dueAt: toDate(fc.due_at),
          status: fc.status,
          completedAt: toDate(fc.completed_at),
        }
      : null,
    lastActivityAt: toDate(row.lastActivityAt),
    breakdown: namedBreakdown(row.breakdown, ruleNames),
  }
}

export class LeadQueueService {
  constructor(private readonly ctx: ServiceContext) {}

  private firstContactPendingOverdue(now: Date) {
    return sql`exists (select 1 from ${activities} a where a.entity_type = 'lead' and a.entity_id = ${leads.id} and a.kind = ${FIRST_CONTACT_TASK_KIND} and a.status = 'pending' and a.due_at < ${now.toISOString()}::timestamptz)`
  }

  /** Conditions shared by the list and the counts: live, non-test leads plus filters. */
  private conditions(filters: LeadQueueFilters, now: Date): SQL[] {
    const conditions: SQL[] = [isNull(leads.deletedAt), eq(leads.isTest, false)]
    const owner =
      filters.view === 'mine' ? 'me' : filters.view === 'unassigned' ? 'unassigned' : filters.owner
    if (owner === 'me') conditions.push(eq(leads.ownerId, requireCrmUserId(this.ctx.auth)))
    else if (owner === 'unassigned') conditions.push(isNull(leads.ownerId))
    else if (owner) conditions.push(eq(leads.ownerId, owner))
    const tier = filters.view === 'tier_a' ? 'A' : filters.tier
    if (tier) conditions.push(eq(leads.tier, tier))
    if (filters.view === 'overdue') conditions.push(this.firstContactPendingOverdue(now))
    return conditions
  }

  async list(filters: LeadQueueFilters = {}): Promise<LeadQueuePage> {
    const now = filters.now ?? new Date()
    const pageSize = Math.min(Math.max(filters.pageSize ?? LEAD_QUEUE_PAGE_SIZE, 1), 200)
    const page = Math.max(filters.page ?? 1, 1)
    const where = and(...this.conditions(filters, now))

    const rows = await this.ctx.db
      .select({
        id: leads.id,
        status: leads.status,
        source: leads.source,
        tier: leads.tier,
        score: leads.score,
        attribution: leads.attribution,
        createdAt: leads.createdAt,
        ownerId: leads.ownerId,
        ownerName: users.name,
        ownerEmail: users.email,
        contactId: contacts.id,
        contactName: contacts.name,
        contactCompany: contacts.company,
        contactEmail: contacts.email,
        contactPhone: contacts.phone,
        breakdown: leadScores.breakdown,
        firstContact: sql<{
          id: string
          due_at: string | null
          status: string
          completed_at: string | null
        } | null>`(select json_build_object('id', a.id, 'due_at', a.due_at, 'status', a.status, 'completed_at', a.completed_at) from ${activities} a where a.entity_type = 'lead' and a.entity_id = ${leads.id} and a.kind = ${FIRST_CONTACT_TASK_KIND} order by a.created_at limit 1)`,
        lastActivityAt: sql<
          string | null
        >`(select max(a.created_at) from ${activities} a where a.entity_type = 'lead' and a.entity_id = ${leads.id})`,
        note: sql<
          string | null
        >`(select n.content from ${notes} n where n.entity_type = 'contact' and n.entity_id = ${leads.contactId} and n.created_at >= ${leads.createdAt} - interval '5 minutes' order by n.created_at limit 1)`,
      })
      .from(leads)
      .leftJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(users, eq(users.id, leads.ownerId))
      .leftJoin(leadScores, eq(leadScores.leadId, leads.id))
      .where(where)
      .orderBy(
        desc(sql`coalesce(${this.firstContactPendingOverdue(now)}, false)`),
        asc(sql`case ${leads.tier} when 'A' then 0 when 'B' then 1 when 'C' then 2 else 3 end`),
        desc(leads.createdAt),
        asc(leads.id),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    const [{ total } = { total: 0 }] = await this.ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(leads)
      .where(where)

    const [ruleNames, tagsByLead] = await Promise.all([
      this.ruleNames(),
      this.tagsFor(rows.map((row) => row.id)),
    ])
    const mask = shouldMaskPiiForAgent(this.ctx.auth)

    const items = rows.map((row) => ({
      ...toQueueRow(row, mask, ruleNames),
      tags: tagsByLead.get(row.id) ?? [],
    }))

    return { items, total, page, pageSize }
  }

  /** How many leads each saved view holds (with the tier filter applied), for the tabs. */
  async counts(filters: Pick<LeadQueueFilters, 'tier' | 'now'> = {}): Promise<LeadQueueCounts> {
    const now = filters.now ?? new Date()
    const base = and(...this.conditions({ tier: filters.tier }, now))
    let me: string | null = null
    try {
      me = requireCrmUserId(this.ctx.auth)
    } catch {
      me = null
    }
    const [row] = await this.ctx.db
      .select({
        all: sql<number>`count(*)::int`,
        mine: me
          ? sql<number>`count(*) filter (where ${leads.ownerId} = ${me})::int`
          : sql<number>`0`,
        tier_a: sql<number>`count(*) filter (where ${leads.tier} = 'A')::int`,
        unassigned: sql<number>`count(*) filter (where ${leads.ownerId} is null)::int`,
        overdue: sql<number>`count(*) filter (where ${this.firstContactPendingOverdue(now)})::int`,
      })
      .from(leads)
      .where(base)
    return {
      all: row?.all ?? 0,
      mine: row?.mine ?? 0,
      tier_a: row?.tier_a ?? 0,
      unassigned: row?.unassigned ?? 0,
      overdue: row?.overdue ?? 0,
    }
  }

  async ruleNames(): Promise<Map<string, string>> {
    const rules = await this.ctx.db
      .select({ id: leadScoringRules.id, name: leadScoringRules.name })
      .from(leadScoringRules)
    return new Map(rules.map((rule) => [rule.id, rule.name]))
  }

  private async tagsFor(leadIds: string[]) {
    const byLead = new Map<string, { id: string; name: string; color: string | null }[]>()
    if (leadIds.length === 0) return byLead
    const rows = await this.ctx.db
      .select({ leadId: taggables.entityId, id: tags.id, name: tags.name, color: tags.color })
      .from(taggables)
      .innerJoin(tags, eq(tags.id, taggables.tagId))
      .where(and(eq(taggables.entityType, 'lead'), inArray(taggables.entityId, leadIds)))
    for (const row of rows) {
      byLead.set(row.leadId, [
        ...(byLead.get(row.leadId) ?? []),
        { id: row.id, name: row.name, color: row.color },
      ])
    }
    return byLead
  }
}

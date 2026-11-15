import { type CaseStatus, type CaseType, cases, contacts } from '@phynd/db/schema'
import type { PaginatedResult, PaginationInput } from '@phynd/types/crm'
import { and, desc, eq, getTableColumns, isNull, ne, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError } from '../errors'
import { requireCrmUserId } from '../identity/actor'
import { defaultCaseDueAt } from './case-deadlines'

export interface CaseListFilters {
  status?: CaseStatus
  /** Only cases not yet resolved (open or in progress). */
  unresolved?: boolean
  ownerId?: string
  contactId?: string
}

export interface CreateCaseInput {
  contactId: string
  type: CaseType
  summary: string
  /** Omitted: computed from the type (`case-deadlines.ts`). */
  dueAt?: Date
  /** Omitted: the caller. `null`: nobody yet. */
  ownerId?: string | null
}

export interface UpdateCaseInput {
  type?: CaseType
  summary?: string
  status?: CaseStatus
  dueAt?: Date
  ownerId?: string | null
}

type CaseRow = typeof cases.$inferSelect
/** A case with its contact's name (null when the contact was deleted). */
export type CaseWithContact = CaseRow & { contactName: string | null }

function caseColumns() {
  return { ...getTableColumns(cases), contactName: contacts.name }
}

/**
 * Cases: requests from a contact that carry a deadline (support, refund,
 * data-rights request, invoice correction). Records only: nothing here sends
 * mail or acts on a case. A case is never deleted; it is resolved.
 */
export class CasesService {
  constructor(private readonly ctx: ServiceContext) {}

  /** Newest opened first; the cursor is the last id of the previous page. */
  async list(
    pagination?: PaginationInput,
    filters?: CaseListFilters,
  ): Promise<PaginatedResult<CaseWithContact>> {
    const limit = pagination?.limit ?? 50
    const conditions = []
    if (pagination?.cursor) {
      conditions.push(
        sql`(${cases.openedAt}, ${cases.id}) < (select c.opened_at, c.id from cases c where c.id = ${pagination.cursor})`,
      )
    }
    if (filters?.status) conditions.push(eq(cases.status, filters.status))
    if (filters?.unresolved) conditions.push(ne(cases.status, 'resolved'))
    if (filters?.ownerId) conditions.push(eq(cases.ownerId, filters.ownerId))
    if (filters?.contactId) conditions.push(eq(cases.contactId, filters.contactId))

    const rows = await this.ctx.db
      .select(caseColumns())
      .from(cases)
      .leftJoin(contacts, and(eq(contacts.id, cases.contactId), isNull(contacts.deletedAt)))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(cases.openedAt), desc(cases.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    }
  }

  async getById(id: string): Promise<CaseWithContact | null> {
    const [row] = await this.ctx.db
      .select(caseColumns())
      .from(cases)
      .leftJoin(contacts, and(eq(contacts.id, cases.contactId), isNull(contacts.deletedAt)))
      .where(eq(cases.id, id))
      .limit(1)
    return row ?? null
  }

  async create(input: CreateCaseInput, now: Date = new Date()): Promise<CaseRow> {
    const [contact] = await this.ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, input.contactId), isNull(contacts.deletedAt)))
      .limit(1)
    if (!contact) throw new NotFoundError('Contact', input.contactId)

    const ownerId =
      input.ownerId !== undefined ? input.ownerId : requireCrmUserId(this.ctx.auth)
    const [row] = await this.ctx.db
      .insert(cases)
      .values({
        contactId: input.contactId,
        type: input.type,
        summary: input.summary,
        status: 'open',
        openedAt: now,
        dueAt: input.dueAt ?? defaultCaseDueAt(input.type, now),
        ownerId,
      })
      .returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return row!
  }

  /**
   * Resolving stamps `resolvedAt`; moving a resolved case back to open or in
   * progress clears it. Changing the type keeps the due date already set.
   */
  async update(id: string, input: UpdateCaseInput, now: Date = new Date()): Promise<CaseRow> {
    const current = await this.getById(id)
    if (!current) throw new NotFoundError('Case', id)

    const values: Partial<typeof cases.$inferInsert> = { updatedAt: now }
    if (input.type !== undefined) values.type = input.type
    if (input.summary !== undefined) values.summary = input.summary
    if (input.dueAt !== undefined) values.dueAt = input.dueAt
    if (input.ownerId !== undefined) values.ownerId = input.ownerId
    if (input.status !== undefined && input.status !== current.status) {
      values.status = input.status
      values.resolvedAt = input.status === 'resolved' ? now : null
    }

    const [row] = await this.ctx.db.update(cases).set(values).where(eq(cases.id, id)).returning()
    if (!row) throw new NotFoundError('Case', id)
    return row
  }
}

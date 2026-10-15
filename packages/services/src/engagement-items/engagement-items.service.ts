import {
  type EngagementItem,
  type EngagementItemKind,
  type EngagementItemSide,
  type EngagementItemStatus,
  engagementArtifacts,
  engagementItems,
  engagements,
} from '@phynd/db/schema'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { ConflictError, NotFoundError, ValidationError } from '../errors'

export interface EngagementItemInput {
  kind: EngagementItemKind
  title: string
  description?: string | null
  status?: EngagementItemStatus
  side?: EngagementItemSide
  ownerUserId?: string | null
  dueAt?: Date | null
  completedAt?: Date | null
  clientVisible?: boolean
  artifactId?: string | null
  externalKey?: string | null
  sortOrder?: number
}

export type EngagementItemPatch = Partial<EngagementItemInput>

/**
 * What the client portal renders for one item: client_visible rows only, no
 * owner, no external key, and the linked artifact's title/url when there is one.
 */
export interface ClientEngagementItem {
  id: string
  kind: EngagementItemKind
  title: string
  description: string | null
  status: EngagementItemStatus
  side: EngagementItemSide
  dueAt: Date | null
  completedAt: Date | null
  artifactTitle: string | null
  artifactUrl: string | null
}

/**
 * completed_at follows status: it is set (to the given time or now) when an
 * item is done and cleared otherwise, so "done" always has a date and nothing
 * else carries one.
 */
export function completedAtFor(
  status: EngagementItemStatus,
  requested: Date | null | undefined,
  current: Date | null = null,
  now: Date = new Date(),
): Date | null {
  if (status !== 'done') return null
  return requested ?? current ?? now
}

function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: unknown }).code : undefined
  const cause = typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : null
  return code(err) === '23505' || code(cause) === '23505'
}

async function guardExternalKey<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError('Another item of this engagement already has that external key')
    }
    throw err
  }
}

export class EngagementItemsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(engagementId: string): Promise<EngagementItem[]> {
    return this.ctx.db
      .select()
      .from(engagementItems)
      .where(eq(engagementItems.engagementId, engagementId))
      .orderBy(asc(engagementItems.sortOrder), asc(engagementItems.createdAt))
  }

  async create(engagementId: string, input: EngagementItemInput): Promise<EngagementItem> {
    await this.requireEngagement(engagementId)
    await this.requireArtifactOf(engagementId, input.artifactId)
    const status = input.status ?? 'planned'
    const sortOrder = input.sortOrder ?? (await this.nextSortOrder(engagementId))
    const [row] = await guardExternalKey(() =>
      this.ctx.db
        .insert(engagementItems)
        .values({
          engagementId,
          kind: input.kind,
          title: input.title,
          description: input.description ?? null,
          status,
          side: input.side ?? 'madfam',
          ownerUserId: input.ownerUserId ?? null,
          dueAt: input.dueAt ?? null,
          completedAt: completedAtFor(status, input.completedAt),
          clientVisible: input.clientVisible ?? false,
          artifactId: input.artifactId ?? null,
          externalKey: input.externalKey ?? null,
          sortOrder,
        })
        .returning(),
    )
    if (!row) throw new ConflictError('Failed to create engagement item')
    return row
  }

  async update(id: string, patch: EngagementItemPatch): Promise<EngagementItem> {
    const existing = await this.getById(id)
    if (patch.artifactId) await this.requireArtifactOf(existing.engagementId, patch.artifactId)
    const status = patch.status ?? existing.status
    const values: Partial<typeof engagementItems.$inferInsert> = {
      ...patch,
      completedAt: completedAtFor(status, patch.completedAt, existing.completedAt),
      updatedAt: new Date(),
    }
    const [row] = await guardExternalKey(() =>
      this.ctx.db.update(engagementItems).set(values).where(eq(engagementItems.id, id)).returning(),
    )
    if (!row) throw new NotFoundError('Engagement item', id)
    return row
  }

  /** Sets sort_order to each id's position. The ids must be exactly the engagement's items. */
  async reorder(engagementId: string, orderedIds: string[]): Promise<EngagementItem[]> {
    const current = await this.list(engagementId)
    const known = new Set(current.map((item) => item.id))
    const requested = new Set(orderedIds)
    if (
      requested.size !== orderedIds.length ||
      requested.size !== known.size ||
      orderedIds.some((id) => !known.has(id))
    ) {
      throw new ValidationError('Reorder needs every item of this engagement exactly once')
    }
    await this.ctx.db.transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx
          .update(engagementItems)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(and(eq(engagementItems.id, id), eq(engagementItems.engagementId, engagementId)))
      }
    })
    return this.list(engagementId)
  }

  async delete(id: string): Promise<{ id: string }> {
    const [row] = await this.ctx.db
      .delete(engagementItems)
      .where(eq(engagementItems.id, id))
      .returning({ id: engagementItems.id })
    if (!row) throw new NotFoundError('Engagement item', id)
    return row
  }

  /** The client portal's items: client_visible = true only, in staff order. */
  async listForClient(engagementId: string): Promise<ClientEngagementItem[]> {
    return this.ctx.db
      .select({
        id: engagementItems.id,
        kind: engagementItems.kind,
        title: engagementItems.title,
        description: engagementItems.description,
        status: engagementItems.status,
        side: engagementItems.side,
        dueAt: engagementItems.dueAt,
        completedAt: engagementItems.completedAt,
        artifactTitle: engagementArtifacts.title,
        artifactUrl: engagementArtifacts.url,
      })
      .from(engagementItems)
      .leftJoin(engagementArtifacts, eq(engagementItems.artifactId, engagementArtifacts.id))
      .where(
        and(
          eq(engagementItems.engagementId, engagementId),
          eq(engagementItems.clientVisible, true),
        ),
      )
      .orderBy(asc(engagementItems.sortOrder), asc(engagementItems.createdAt))
  }

  private async getById(id: string): Promise<EngagementItem> {
    const [row] = await this.ctx.db
      .select()
      .from(engagementItems)
      .where(eq(engagementItems.id, id))
      .limit(1)
    if (!row) throw new NotFoundError('Engagement item', id)
    return row
  }

  private async requireEngagement(engagementId: string) {
    const [row] = await this.ctx.db
      .select({ id: engagements.id })
      .from(engagements)
      .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
      .limit(1)
    if (!row) throw new NotFoundError('Engagement', engagementId)
  }

  private async requireArtifactOf(engagementId: string, artifactId: string | null | undefined) {
    if (!artifactId) return
    const [row] = await this.ctx.db
      .select({ id: engagementArtifacts.id })
      .from(engagementArtifacts)
      .where(
        and(
          eq(engagementArtifacts.id, artifactId),
          eq(engagementArtifacts.engagementId, engagementId),
        ),
      )
      .limit(1)
    if (!row) throw new ValidationError('The artifact does not belong to this engagement')
  }

  private async nextSortOrder(engagementId: string): Promise<number> {
    const [row] = await this.ctx.db
      .select({ next: sql<number>`coalesce(max(${engagementItems.sortOrder}) + 1, 0)` })
      .from(engagementItems)
      .where(eq(engagementItems.engagementId, engagementId))
    return Number(row?.next ?? 0)
  }
}

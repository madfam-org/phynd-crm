import { notifications } from '@phyne/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class NotificationsService {
  constructor(private readonly ctx: ServiceContext) {}

  async listForUser(userId: string, opts?: { unreadOnly?: boolean; limit?: number }) {
    const conditions = [eq(notifications.userId, userId)]
    if (opts?.unreadOnly) {
      conditions.push(eq(notifications.isRead, false))
    }

    return this.ctx.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(opts?.limit ?? 50)
  }

  async create(data: {
    userId: string
    type: string
    title: string
    message?: string
    entityType?: string
    entityId?: string
  }) {
    const [notification] = await this.ctx.db.insert(notifications).values(data).returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the inserted row
    return notification!
  }

  async markAsRead(id: string) {
    const [notification] = await this.ctx.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notifications.id, id))
      .returning()
    return notification ?? null
  }

  async markAllAsRead(userId: string) {
    await this.ctx.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
  }

  async getUnreadCount(userId: string): Promise<number> {
    const [result] = await this.ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    return result?.count ?? 0
  }
}

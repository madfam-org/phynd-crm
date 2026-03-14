import { describe, expect, it } from 'vitest'
import { NotificationsService } from '../notifications/notifications.service'
import { createTestContext } from './helpers'

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date('2025-01-15T10:00:00Z'),
    entityId: null,
    entityType: null,
    id: 'notif-001',
    isRead: false,
    message: 'Test notification message',
    readAt: null,
    title: 'Test Notification',
    type: 'owner_assignment',
    userId: 'test-user',
    ...overrides,
  }
}

describe('NotificationsService', () => {
  describe('listForUser()', () => {
    it('returns notifications for a given user', async () => {
      const notif = makeNotification()
      const ctx = createTestContext([notif])
      const service = new NotificationsService(ctx)

      const result = await service.listForUser('test-user')

      expect(result).toEqual([notif])
    })

    it('returns empty array when no notifications exist', async () => {
      const ctx = createTestContext([])
      const service = new NotificationsService(ctx)

      const result = await service.listForUser('test-user')

      expect(result).toEqual([])
    })
  })

  describe('create()', () => {
    it('creates a notification', async () => {
      const notif = makeNotification()
      const ctx = createTestContext([notif])
      const service = new NotificationsService(ctx)

      const result = await service.create({
        userId: 'test-user',
        type: 'owner_assignment',
        title: 'Test Notification',
        message: 'Test message',
      })

      expect(result).toEqual(notif)
      expect(ctx.mockDb.insert).toHaveBeenCalled()
    })
  })

  describe('markAsRead()', () => {
    it('marks a notification as read', async () => {
      const notif = makeNotification({ isRead: true, readAt: new Date() })
      const ctx = createTestContext([notif])
      const service = new NotificationsService(ctx)

      const result = await service.markAsRead('notif-001')

      expect(result).toEqual(notif)
      expect(ctx.mockDb.update).toHaveBeenCalled()
    })

    it('returns null for non-existent notification', async () => {
      const ctx = createTestContext([])
      const service = new NotificationsService(ctx)

      const result = await service.markAsRead('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('markAllAsRead()', () => {
    it('marks all notifications as read for a user', async () => {
      const ctx = createTestContext()
      const service = new NotificationsService(ctx)

      await service.markAllAsRead('test-user')

      expect(ctx.mockDb.update).toHaveBeenCalled()
    })
  })

  describe('getUnreadCount()', () => {
    it('returns unread count', async () => {
      const ctx = createTestContext([{ count: 5 }])
      const service = new NotificationsService(ctx)

      const count = await service.getUnreadCount('test-user')

      expect(count).toBe(5)
    })

    it('returns 0 when no unread notifications', async () => {
      const ctx = createTestContext([{ count: 0 }])
      const service = new NotificationsService(ctx)

      const count = await service.getUnreadCount('test-user')

      expect(count).toBe(0)
    })
  })
})

'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { Bell } from 'lucide-react'
import { useRouter } from 'next/navigation'

type NotificationsListOutput = inferRouterOutputs<AppRouter>['notifications']['list']
type NotificationRow = NotificationsListOutput[number]

export function NotificationBell() {
  const router = useRouter()
  const notificationsRouter = trpc.notifications as NonNullable<typeof trpc.notifications>
  const unreadCountQuery = notificationsRouter.unreadCount as NonNullable<
    typeof notificationsRouter.unreadCount
  >
  const listNotifications = notificationsRouter.list as NonNullable<
    typeof notificationsRouter.list
  >
  const markAsRead = notificationsRouter.markAsRead as NonNullable<
    typeof notificationsRouter.markAsRead
  >
  const markAllAsRead = notificationsRouter.markAllAsRead as NonNullable<
    typeof notificationsRouter.markAllAsRead
  >
  const { data: unreadCountData } = unreadCountQuery.useQuery(undefined, {
    refetchInterval: 30_000,
  })
  const { data: notificationsData } = listNotifications.useQuery(
    { limit: 10 },
    { refetchInterval: 30_000 },
  )
  const unreadCount = typeof unreadCountData === 'number' ? unreadCountData : 0
  const notifications = (notificationsData as NotificationsListOutput | undefined) ?? []

  const utils = trpc.useUtils()
  const notificationsUtils = utils.notifications as NonNullable<typeof utils.notifications>
  const unreadCountUtils = notificationsUtils.unreadCount as NonNullable<
    typeof notificationsUtils.unreadCount
  >
  const listUtils = notificationsUtils.list as NonNullable<typeof notificationsUtils.list>
  const markAsReadMutation = markAsRead.useMutation({
    onSuccess: () => {
      unreadCountUtils.invalidate()
      listUtils.invalidate()
    },
  })
  const markAllAsReadMutation = markAllAsRead.useMutation({
    onSuccess: () => {
      unreadCountUtils.invalidate()
      listUtils.invalidate()
    },
  })

  function handleNotificationClick(notification: NotificationRow) {
    if (!notification.isRead) {
      markAsReadMutation.mutate({ id: notification.id })
    }
    if (notification.entityType && notification.entityId) {
      const path =
        notification.entityType === 'contact'
          ? `/clients/${notification.entityId}`
          : `/${notification.entityType}s/${notification.entityId}`
      router.push(path)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full p-0 text-[10px]"
            >
              {unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-muted-foreground"
              onClick={() => markAllAsReadMutation.mutate()}
            >
              Mark all as read
            </Button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No notifications
          </div>
        ) : (
          notifications.map((n: NotificationRow) => (
            <DropdownMenuItem
              key={n.id}
              className={`flex flex-col items-start gap-1 ${!n.isRead ? 'bg-accent/50' : ''}`}
              onClick={() => handleNotificationClick(n)}
            >
              <span className="text-sm font-medium">{n.title}</span>
              {n.message && <span className="text-xs text-muted-foreground">{n.message}</span>}
              <span className="text-[10px] text-muted-foreground">
                {new Date(n.createdAt).toLocaleString()}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

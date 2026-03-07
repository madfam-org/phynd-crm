'use client'

import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'

export default function ActivitiesPage() {
  const { data: activities, isLoading } = trpc.activities.list.useQuery({})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Activities</h1>
        <p className="text-muted-foreground">Track tasks, calls, and meetings</p>
      </div>
      <div className="space-y-2">
        {isLoading && (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((n) => (
              <div key={n} className="h-16 animate-pulse rounded-lg border bg-muted" />
            ))}
          </div>
        )}
        {activities?.map((activity) => (
          <div
            key={activity.id}
            className="flex items-center justify-between rounded-lg border p-4"
          >
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                {activity.type}
              </span>
              <div>
                <p className="font-medium">{activity.title}</p>
                {activity.description && (
                  <p className="text-sm text-muted-foreground">{activity.description}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                variant={
                  activity.status === 'completed'
                    ? 'success'
                    : activity.status === 'cancelled'
                      ? 'secondary'
                      : 'default'
                }
              >
                {activity.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(activity.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
        {activities && activities.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">No activities yet.</p>
        )}
      </div>
    </div>
  )
}

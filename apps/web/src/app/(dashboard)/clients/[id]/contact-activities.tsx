'use client'

import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'

interface ContactActivitiesProps {
  contactId: string
}

export function ContactActivities({ contactId }: ContactActivitiesProps) {
  const activitiesRouter = trpc.activities as NonNullable<typeof trpc.activities>
  const listForEntity = activitiesRouter.listForEntity as NonNullable<
    typeof activitiesRouter.listForEntity
  >
  const { data: activities } = listForEntity.useQuery({
    entityType: 'contact',
    entityId: contactId,
  })
  type ContactActivity = NonNullable<typeof activities>[number]

  if (!activities?.length) {
    return <p className="text-sm text-muted-foreground">No activities yet.</p>
  }

  return (
    <div className="space-y-3">
      {activities.map((activity: ContactActivity) => (
        <div key={activity.id} className="flex items-center justify-between rounded-lg border p-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{activity.type}</Badge>
              <span className="text-sm font-medium">{activity.title}</span>
            </div>
            {activity.description && (
              <p className="mt-1 text-xs text-muted-foreground">{activity.description}</p>
            )}
          </div>
          <Badge variant={activity.status === 'completed' ? 'success' : 'secondary'}>
            {activity.status}
          </Badge>
        </div>
      ))}
    </div>
  )
}

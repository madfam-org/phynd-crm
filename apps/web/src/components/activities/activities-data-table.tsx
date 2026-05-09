'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'
import { CreateActivityDialog } from './create-activity-dialog'
import { DeleteActivityDialog } from './delete-activity-dialog'
import { EditActivityDialog } from './edit-activity-dialog'

type ActivitiesListOutput = inferRouterOutputs<AppRouter>['activities']['list']
type ActivityRow = ActivitiesListOutput['items'][number]

interface ActivitiesDataTableProps {
  initialData: ActivitiesListOutput
}

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString()
}

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleString()
}

function truncate(text: string | null, maxLength: number): string {
  if (!text) return '—'
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function typeBadgeVariant(type: string): 'default' | 'secondary' | 'outline' {
  switch (type) {
    case 'call':
    case 'meeting':
      return 'default'
    case 'email':
    case 'task':
      return 'secondary'
    default:
      return 'outline'
  }
}

function statusBadgeVariant(status: string): 'success' | 'secondary' | 'default' | 'warning' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'cancelled':
      return 'secondary'
    case 'pending':
      return 'warning'
    default:
      return 'default'
  }
}

export function ActivitiesDataTable({ initialData }: ActivitiesDataTableProps) {
  const { data } = trpc.activities.list.useQuery({}, { initialData, refetchInterval: 60_000 })
  const activities = data?.items ?? []

  const [editActivity, setEditActivity] = useState<ActivityRow | null>(null)
  const [deleteActivity, setDeleteActivity] = useState<ActivityRow | null>(null)

  const utils = trpc.useUtils()
  const completeMutation = trpc.activities.complete.useMutation({
    onSuccess: () => {
      utils.activities.list.invalidate()
    },
    onError: (err) => toast.error('Failed to complete activity', { description: err.message }),
  })

  const columns: ColumnDef<ActivityRow>[] = [
    {
      id: 'type',
      header: 'Type',
      cell: (row) => (
        <Badge variant={typeBadgeVariant(row.type)} className="capitalize">
          {row.type}
        </Badge>
      ),
    },
    {
      id: 'title',
      header: 'Title',
      cell: (row) => <span className="font-medium">{row.title}</span>,
    },
    {
      id: 'description',
      header: 'Description',
      cell: (row) => <span className="text-muted-foreground">{truncate(row.description, 50)}</span>,
    },
    {
      id: 'entity',
      header: 'Entity',
      cell: (row) => (
        <span className="text-xs capitalize text-muted-foreground">{row.entityType}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={statusBadgeVariant(row.status)} className="capitalize">
          {row.status}
        </Badge>
      ),
    },
    {
      id: 'dueAt',
      header: 'Due Date',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDateTime(row.dueAt)}</span>
      ),
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      className: 'w-[50px]',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              ...
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditActivity(row)}>Edit</DropdownMenuItem>
            {row.status !== 'completed' && (
              <DropdownMenuItem onClick={() => completeMutation.mutate({ id: row.id })}>
                Complete
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteActivity(row)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateActivityDialog />
      </div>
      <DataTable columns={columns} data={activities} getRowKey={(row) => row.id} />
      {editActivity && (
        <EditActivityDialog
          activity={editActivity}
          open={!!editActivity}
          onOpenChange={(open) => !open && setEditActivity(null)}
        />
      )}
      {deleteActivity && (
        <DeleteActivityDialog
          activityId={deleteActivity.id}
          activityTitle={deleteActivity.title}
          open={!!deleteActivity}
          onOpenChange={(open) => !open && setDeleteActivity(null)}
        />
      )}
    </div>
  )
}

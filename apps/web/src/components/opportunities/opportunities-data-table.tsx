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
import type { AppRouter } from '@phyne/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'
import { CreateOpportunityDialog } from './create-opportunity-dialog'
import { EditOpportunityDialog } from './edit-opportunity-dialog'

type OpportunityRow = inferRouterOutputs<AppRouter>['opportunities']['list'][number]

interface OpportunitiesDataTableProps {
  initialData: OpportunityRow[]
}

const statusVariant: Record<string, 'default' | 'success' | 'destructive'> = {
  open: 'default',
  won: 'success',
  lost: 'destructive',
}

export function OpportunitiesDataTable({ initialData }: OpportunitiesDataTableProps) {
  const { data: opportunities } = trpc.opportunities.list.useQuery(undefined, {
    initialData,
  })
  const [editOpp, setEditOpp] = useState<OpportunityRow | null>(null)

  const utils = trpc.useUtils()
  const deleteMutation = trpc.opportunities.delete.useMutation({
    onSuccess: () => utils.opportunities.list.invalidate(),
    onError: (err) => toast.error('Failed to delete opportunity', { description: err.message }),
  })

  const columns: ColumnDef<OpportunityRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'value',
      header: 'Value',
      cell: (row) => (row.value ? `$${Number(row.value).toLocaleString()}` : '—'),
    },
    {
      id: 'probability',
      header: 'Probability',
      cell: (row) => (row.probability != null ? `${row.probability}%` : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <Badge variant={statusVariant[row.status] ?? 'default'}>{row.status}</Badge>,
    },
    {
      id: 'expectedClose',
      header: 'Expected Close',
      cell: (row) =>
        row.expectedCloseDate ? new Date(row.expectedCloseDate).toLocaleDateString() : '—',
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
            <DropdownMenuItem onClick={() => setEditOpp(row)}>Edit</DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => deleteMutation.mutate({ id: row.id })}
            >
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
        <CreateOpportunityDialog />
      </div>
      <DataTable columns={columns} data={opportunities ?? []} getRowKey={(row) => row.id} />
      {editOpp && (
        <EditOpportunityDialog
          opportunity={editOpp}
          open={!!editOpp}
          onOpenChange={(open) => !open && setEditOpp(null)}
        />
      )}
    </div>
  )
}

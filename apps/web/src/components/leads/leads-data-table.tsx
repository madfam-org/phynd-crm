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
import { CreateLeadDialog } from './create-lead-dialog'
import { EditLeadDialog } from './edit-lead-dialog'

type LeadRow = inferRouterOutputs<AppRouter>['leads']['list'][number]

interface LeadsDataTableProps {
  initialData: LeadRow[]
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  new: 'default',
  contacted: 'warning',
  qualified: 'success',
  unqualified: 'secondary',
  converted: 'success',
}

export function LeadsDataTable({ initialData }: LeadsDataTableProps) {
  const { data: leads } = trpc.leads.list.useQuery(undefined, { initialData })
  const [editLead, setEditLead] = useState<LeadRow | null>(null)

  const utils = trpc.useUtils()
  const deleteMutation = trpc.leads.delete.useMutation({
    onSuccess: () => utils.leads.list.invalidate(),
    onError: (err) => toast.error('Failed to delete lead', { description: err.message }),
  })

  const columns: ColumnDef<LeadRow>[] = [
    {
      id: 'id',
      header: 'ID',
      cell: (row) => <span className="font-mono text-xs">{row.id.slice(0, 8)}</span>,
    },
    { id: 'source', header: 'Source', cell: (row) => row.source ?? '—' },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <Badge variant={statusVariant[row.status] ?? 'default'}>{row.status}</Badge>,
    },
    {
      id: 'score',
      header: 'Score',
      cell: (row) => (row.score != null ? String(row.score) : '—'),
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
            <DropdownMenuItem onClick={() => setEditLead(row)}>Edit</DropdownMenuItem>
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
        <CreateLeadDialog />
      </div>
      <DataTable columns={columns} data={leads ?? []} getRowKey={(row) => row.id} />
      {editLead && (
        <EditLeadDialog
          lead={editLead}
          open={!!editLead}
          onOpenChange={(open) => !open && setEditLead(null)}
        />
      )}
    </div>
  )
}

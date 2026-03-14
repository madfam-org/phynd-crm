'use client'

import { Badge } from '@/components/ui/badge'
import { BulkActionsToolbar } from '@/components/ui/bulk-actions-toolbar'
import { Button } from '@/components/ui/button'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { exportToCsv } from '@/lib/csv-export'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phyne/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CreateLeadDialog } from './create-lead-dialog'
import { EditLeadDialog } from './edit-lead-dialog'

type LeadsListOutput = inferRouterOutputs<AppRouter>['leads']['list']
type LeadRow = LeadsListOutput['items'][number]

interface LeadsDataTableProps {
  initialData: LeadsListOutput
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  new: 'default',
  contacted: 'warning',
  qualified: 'success',
  unqualified: 'secondary',
  converted: 'success',
}

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const

export function LeadsDataTable({ initialData }: LeadsDataTableProps) {
  const { data: leads } = trpc.leads.list.useQuery(undefined, {
    initialData,
    refetchInterval: 60_000,
  })
  const { data: usersData } = trpc.users.list.useQuery(undefined, {
    retry: false,
  })
  const [editLead, setEditLead] = useState<LeadRow | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<string>('')

  const userMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of usersData?.items ?? []) {
      map.set(u.id, u.name ?? u.email)
    }
    return map
  }, [usersData])

  const utils = trpc.useUtils()
  const deleteMutation = trpc.leads.delete.useMutation({
    onSuccess: () => utils.leads.list.invalidate(),
    onError: (err) => toast.error('Failed to delete lead', { description: err.message }),
  })
  const bulkUpdateMutation = trpc.leads.bulkUpdateStatus.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate()
      setSelectedKeys(new Set())
      setBulkStatus('')
      toast.success('Leads updated')
    },
    onError: (err) => toast.error('Failed to update leads', { description: err.message }),
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
      id: 'owner',
      header: 'Owner',
      cell: (row) => (row.ownerId ? (userMap.get(row.ownerId) ?? '—') : '—'),
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

  function handleBulkStatusChange() {
    if (!bulkStatus || selectedKeys.size === 0) return
    const ids = Array.from(selectedKeys) as string[]
    bulkUpdateMutation.mutate({
      ids,
      status: bulkStatus as (typeof LEAD_STATUSES)[number],
    })
  }

  function handleExport() {
    const items = leads?.items ?? []
    const toExport = selectedKeys.size > 0 ? items.filter((l) => selectedKeys.has(l.id)) : items
    exportToCsv(
      toExport,
      [
        { key: 'id', header: 'ID' },
        { key: 'source', header: 'Source' },
        { key: 'status', header: 'Status' },
        { key: 'score', header: 'Score' },
      ],
      'leads',
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <BulkActionsToolbar
          selectedCount={selectedKeys.size}
          onChangeStatus={handleBulkStatusChange}
          onExport={handleExport}
        />
        <CreateLeadDialog />
      </div>
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-2">
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select status..." />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <DataTable
        columns={columns}
        data={leads?.items ?? []}
        getRowKey={(row) => row.id}
        selectable
        onSelectionChange={setSelectedKeys}
      />
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

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
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CreateOpportunityDialog } from './create-opportunity-dialog'
import { EditOpportunityDialog } from './edit-opportunity-dialog'

type OpportunitiesListOutput = inferRouterOutputs<AppRouter>['opportunities']['list']
type OpportunityRow = OpportunitiesListOutput['items'][number]

interface OpportunitiesDataTableProps {
  initialData: OpportunitiesListOutput
}

const statusVariant: Record<string, 'default' | 'success' | 'destructive'> = {
  open: 'default',
  won: 'success',
  lost: 'destructive',
}

const OPP_STATUSES = ['open', 'won', 'lost'] as const

type ViewMode = 'all' | 'mine'

export function OpportunitiesDataTable({ initialData }: OpportunitiesDataTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('all')

  const { data: allOpportunities } = trpc.opportunities.list.useQuery(undefined, {
    initialData,
    refetchInterval: 60_000,
    enabled: viewMode === 'all',
  })
  const { data: myOpportunities } = trpc.opportunities.listMine.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: viewMode === 'mine',
  })

  const opportunities = viewMode === 'mine' ? myOpportunities : allOpportunities
  const { data: usersData } = trpc.users.list.useQuery(undefined, {
    retry: false,
  })
  const { data: defaultPipeline } = trpc.pipelines.getDefault.useQuery()
  const pipelineId = defaultPipeline?.id ?? ''
  const { data: stagesData } = trpc.pipelines.getStages.useQuery(
    { pipelineId },
    { enabled: !!defaultPipeline?.id },
  )
  const [editOpp, setEditOpp] = useState<OpportunityRow | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<string>('')

  const userMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of usersData?.items ?? []) {
      map.set(u.id, u.name ?? u.email)
    }
    return map
  }, [usersData])

  const stageMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of stagesData ?? []) {
      map.set(s.id, s.name)
    }
    return map
  }, [stagesData])

  const utils = trpc.useUtils()
  const invalidateOpportunities = () => {
    utils.opportunities.list.invalidate()
    utils.opportunities.listMine.invalidate()
  }
  const deleteMutation = trpc.opportunities.delete.useMutation({
    onSuccess: invalidateOpportunities,
    onError: (err) => toast.error('Failed to delete opportunity', { description: err.message }),
  })
  const bulkUpdateMutation = trpc.opportunities.bulkUpdateStatus.useMutation({
    onSuccess: () => {
      invalidateOpportunities()
      setSelectedKeys(new Set())
      setBulkStatus('')
      toast.success('Opportunities updated')
    },
    onError: (err) => toast.error('Failed to update opportunities', { description: err.message }),
  })

  const columns: ColumnDef<OpportunityRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => (
        <Link
          href={`/opportunities/${row.id}`}
          className="font-medium text-primary hover:underline"
        >
          {row.name}
        </Link>
      ),
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
      id: 'stage',
      header: 'Stage',
      cell: (row) => stageMap.get(row.stageId) ?? '—',
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: (row) => (row.ownerId ? (userMap.get(row.ownerId) ?? '—') : '—'),
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
            <DropdownMenuItem asChild>
              <Link href={`/opportunities/${row.id}`}>View</Link>
            </DropdownMenuItem>
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

  function handleBulkStatusChange() {
    if (!bulkStatus || selectedKeys.size === 0) return
    const ids = Array.from(selectedKeys) as string[]
    bulkUpdateMutation.mutate({
      ids,
      status: bulkStatus as (typeof OPP_STATUSES)[number],
    })
  }

  function handleExport() {
    const items = opportunities?.items ?? []
    const toExport = selectedKeys.size > 0 ? items.filter((o) => selectedKeys.has(o.id)) : items
    exportToCsv(
      toExport,
      [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'value', header: 'Value' },
        { key: 'probability', header: 'Probability' },
        { key: 'status', header: 'Status' },
      ],
      'opportunities',
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <fieldset className="inline-flex rounded-md border">
            <Button
              variant={viewMode === 'mine' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-r-none"
              onClick={() => setViewMode('mine')}
            >
              My Deals
            </Button>
            <Button
              variant={viewMode === 'all' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-l-none"
              onClick={() => setViewMode('all')}
            >
              All Deals
            </Button>
          </fieldset>
          <BulkActionsToolbar
            selectedCount={selectedKeys.size}
            onChangeStatus={handleBulkStatusChange}
            onExport={handleExport}
          />
        </div>
        <CreateOpportunityDialog />
      </div>
      {selectedKeys.size > 0 && (
        <div className="flex items-center gap-2">
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select status..." />
            </SelectTrigger>
            <SelectContent>
              {OPP_STATUSES.map((s) => (
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
        data={opportunities?.items ?? []}
        getRowKey={(row) => row.id}
        selectable
        onSelectionChange={setSelectedKeys}
      />
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

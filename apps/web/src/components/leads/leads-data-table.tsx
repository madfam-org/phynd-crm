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
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CreateLeadDialog } from './create-lead-dialog'
import { DeleteLeadDialog } from './delete-lead-dialog'
import { EditLeadDialog } from './edit-lead-dialog'

type LeadsListOutput = inferRouterOutputs<AppRouter>['leads']['list']
type LeadRow = LeadsListOutput['items'][number]
type UsersListOutput = inferRouterOutputs<AppRouter>['users']['list']
type PipelineDefaultOutput = inferRouterOutputs<AppRouter>['pipelines']['getDefault']
type PipelineStagesOutput = inferRouterOutputs<AppRouter>['pipelines']['getStages']

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

type ViewMode = 'all' | 'mine'

export function LeadsDataTable({ initialData }: LeadsDataTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('all')

  const leadsRouter = trpc.leads as NonNullable<typeof trpc.leads>
  const usersRouter = trpc.users as NonNullable<typeof trpc.users>
  const pipelinesRouter = trpc.pipelines as NonNullable<typeof trpc.pipelines>
  const listLeads = leadsRouter.list as NonNullable<typeof leadsRouter.list>
  const listMineLeads = leadsRouter.listMine as NonNullable<typeof leadsRouter.listMine>
  const bulkUpdateLeadStatus = leadsRouter.bulkUpdateStatus as NonNullable<
    typeof leadsRouter.bulkUpdateStatus
  >
  const listUsers = usersRouter.list as NonNullable<typeof usersRouter.list>
  const getDefaultPipeline = pipelinesRouter.getDefault as NonNullable<
    typeof pipelinesRouter.getDefault
  >
  const getStages = pipelinesRouter.getStages as NonNullable<typeof pipelinesRouter.getStages>

  const { data: allLeadsData } = listLeads.useQuery(undefined, {
    initialData,
    refetchInterval: 60_000,
    enabled: viewMode === 'all',
  })
  const { data: myLeadsData } = listMineLeads.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: viewMode === 'mine',
  })

  const leadsData = viewMode === 'mine' ? myLeadsData : allLeadsData
  const leads = (leadsData as LeadsListOutput | undefined)?.items ?? []
  const { data: usersData } = listUsers.useQuery(undefined, {
    retry: false,
  })
  const users = (usersData as UsersListOutput | undefined)?.items ?? []
  const { data: defaultPipelineData } = getDefaultPipeline.useQuery()
  const defaultPipeline = defaultPipelineData as PipelineDefaultOutput | undefined
  const pipelineId = defaultPipeline?.id ?? ''
  const { data: stagesData } = getStages.useQuery(
    { pipelineId },
    { enabled: !!defaultPipeline?.id },
  )
  const stages = (stagesData as PipelineStagesOutput | undefined) ?? []
  const [editLead, setEditLead] = useState<LeadRow | null>(null)
  const [leadToDelete, setLeadToDelete] = useState<LeadRow | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<string>('')

  const userMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of users) {
      map.set(u.id, u.name ?? u.email)
    }
    return map
  }, [users])

  const stageMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of stages) {
      map.set(s.id, s.name)
    }
    return map
  }, [stages])

  const utils = trpc.useUtils()
  const leadsUtils = utils.leads as NonNullable<typeof utils.leads>
  const listLeadsUtils = leadsUtils.list as NonNullable<typeof leadsUtils.list>
  const listMineLeadsUtils = leadsUtils.listMine as NonNullable<typeof leadsUtils.listMine>
  const invalidateLeads = () => {
    listLeadsUtils.invalidate()
    listMineLeadsUtils.invalidate()
  }
  const bulkUpdateMutation = bulkUpdateLeadStatus.useMutation({
    onSuccess: () => {
      invalidateLeads()
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
      cell: (row) => (
        <Link href={`/leads/${row.id}`} className="font-mono text-xs text-primary hover:underline">
          {row.id.slice(0, 8)}
        </Link>
      ),
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
              <Link href={`/leads/${row.id}`}>View</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditLead(row)}>Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setLeadToDelete(row)}>
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
    const items = leads
    const toExport =
      selectedKeys.size > 0 ? items.filter((l: LeadRow) => selectedKeys.has(l.id)) : items
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
        data={leads}
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
      {leadToDelete && (
        <DeleteLeadDialog
          leadId={leadToDelete.id}
          leadLabel={leadToDelete.source ?? leadToDelete.id.slice(0, 8)}
          open={!!leadToDelete}
          onOpenChange={(open) => !open && setLeadToDelete(null)}
        />
      )}
    </div>
  )
}

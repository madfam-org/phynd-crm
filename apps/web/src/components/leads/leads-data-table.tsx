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
  DropdownMenuSeparator,
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
import type { LeadAttribution } from '@phynd/types/crm'
import type { inferRouterOutputs } from '@trpc/server'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AssignLeadSubmenu, assigneeLabel, useAssignLead, useLeadAssignees } from './assign-lead'
import { CreateLeadDialog } from './create-lead-dialog'
import { DeleteLeadDialog } from './delete-lead-dialog'
import { EditLeadDialog } from './edit-lead-dialog'
import { LEAD_TIER_FILTERS, type LeadsFilters, leadsHref } from './lead-filters'
import { LeadTierBadge, WaitlistBadge } from './lead-tier-badge'

type LeadsListOutput = inferRouterOutputs<AppRouter>['leads']['list']
type LeadRow = LeadsListOutput['items'][number]
type UsersListOutput = inferRouterOutputs<AppRouter>['users']['list']
type PipelineDefaultOutput = inferRouterOutputs<AppRouter>['pipelines']['getDefault']
type PipelineStagesOutput = inferRouterOutputs<AppRouter>['pipelines']['getStages']

interface LeadsDataTableProps {
  initialData: LeadsListOutput
  /** From the URL (`?owner=`, `?tier=`); the chips below change the URL. */
  filters?: LeadsFilters
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  new: 'default',
  contacted: 'warning',
  qualified: 'success',
  unqualified: 'secondary',
  converted: 'success',
}

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const

function FilterChip({
  href,
  active,
  children,
}: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Button asChild variant={active ? 'default' : 'outline'} size="sm" aria-pressed={active}>
      <Link href={href} scroll={false}>
        {children}
      </Link>
    </Button>
  )
}

export function LeadsDataTable({ initialData, filters = {} }: LeadsDataTableProps) {
  const leadsRouter = trpc.leads as NonNullable<typeof trpc.leads>
  const usersRouter = trpc.users as NonNullable<typeof trpc.users>
  const pipelinesRouter = trpc.pipelines as NonNullable<typeof trpc.pipelines>
  const listLeads = leadsRouter.list as NonNullable<typeof leadsRouter.list>
  const bulkUpdateLeadStatus = leadsRouter.bulkUpdateStatus as NonNullable<
    typeof leadsRouter.bulkUpdateStatus
  >
  const listUsers = usersRouter.list as NonNullable<typeof usersRouter.list>
  const getDefaultPipeline = pipelinesRouter.getDefault as NonNullable<
    typeof pipelinesRouter.getDefault
  >
  const getStages = pipelinesRouter.getStages as NonNullable<typeof pipelinesRouter.getStages>

  const query = {
    ...(filters.owner ? { owner: filters.owner } : {}),
    ...(filters.tier ? { tier: filters.tier } : {}),
  }
  const { data: leadsData } = listLeads.useQuery(
    Object.keys(query).length > 0 ? query : undefined,
    {
      initialData,
      refetchInterval: 60_000,
    },
  )
  const leads = (leadsData as LeadsListOutput | undefined)?.items ?? []
  const assignees = useLeadAssignees()
  const assignMutation = useAssignLead()
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

  // Assignees are readable by all staff; the full user list only by admins.
  const userMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of users) {
      map.set(u.id, u.name ?? u.email)
    }
    for (const a of assignees) {
      map.set(a.id, assigneeLabel(a))
    }
    return map
  }, [users, assignees])

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
  const invalidateLeads = () => {
    listLeadsUtils.invalidate()
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
      id: 'tier',
      header: 'Tier',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <LeadTierBadge tier={row.tier} />
          <WaitlistBadge intent={(row.attribution as LeadAttribution | null)?.intent} />
        </div>
      ),
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
            <AssignLeadSubmenu
              leadId={row.id}
              ownerId={row.ownerId}
              assignees={assignees}
              onAssign={(input) => assignMutation.mutate(input)}
            />
            <DropdownMenuItem onClick={() => setEditLead(row)}>Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
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
        { key: 'tier', header: 'Tier' },
        { key: 'score', header: 'Score' },
      ],
      'leads',
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href={leadsHref({ tier: filters.tier })} active={!filters.owner}>
          All leads
        </FilterChip>
        <FilterChip
          href={leadsHref({ owner: 'me', tier: filters.tier })}
          active={filters.owner === 'me'}
        >
          My leads
        </FilterChip>
        <FilterChip
          href={leadsHref({ owner: 'unassigned', tier: filters.tier })}
          active={filters.owner === 'unassigned'}
        >
          Unassigned
        </FilterChip>
        {filters.owner && filters.owner !== 'me' && filters.owner !== 'unassigned' && (
          <FilterChip href={leadsHref(filters)} active>
            Owner: {userMap.get(filters.owner) ?? filters.owner.slice(0, 8)}
          </FilterChip>
        )}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <FilterChip href={leadsHref({ owner: filters.owner })} active={!filters.tier}>
          Any tier
        </FilterChip>
        {LEAD_TIER_FILTERS.map((tier) => (
          <FilterChip
            key={tier}
            href={leadsHref({ owner: filters.owner, tier })}
            active={filters.tier === tier}
          >
            Tier {tier}
          </FilterChip>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
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

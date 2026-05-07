'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ColumnDef, FilterOption } from '@/components/ui/data-table'
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
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CreateClientProjectDialog } from './create-client-project-dialog'
import { CreateEngagementDialog } from './create-engagement-dialog'
import { DeleteEngagementDialog } from './delete-engagement-dialog'

type EngagementsListOutput = inferRouterOutputs<AppRouter>['engagements']['list']
type EngagementRow = EngagementsListOutput['items'][number]

type ContactsListOutput = inferRouterOutputs<AppRouter>['contacts']['list']
type OpportunitiesListOutput = inferRouterOutputs<AppRouter>['opportunities']['list']

interface EngagementsDataTableProps {
  initialData: EngagementsListOutput
}

const statusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  active: 'default',
  completed: 'success',
  paused: 'warning',
  cancelled: 'destructive',
}

const STATUS_FILTERS: FilterOption[] = [
  { label: 'Active', value: 'active' },
  { label: 'Completed', value: 'completed' },
  { label: 'Paused', value: 'paused' },
  { label: 'Cancelled', value: 'cancelled' },
]

interface DisplayRow {
  id: string
  projectName: string
  status: string
  contactId: string
  opportunityId: string | null
  contactName: string
  opportunityName: string | null
  createdAt: Date
}

function buildDisplayRows(
  rows: EngagementRow[],
  contacts: ContactsListOutput | undefined,
  opportunities: OpportunitiesListOutput | undefined,
): DisplayRow[] {
  const contactMap = new Map<string, string>()
  for (const c of contacts?.items ?? []) {
    contactMap.set(c.id, c.name)
  }
  const oppMap = new Map<string, string>()
  for (const o of opportunities?.items ?? []) {
    oppMap.set(o.id, o.name)
  }
  return rows.map((row) => ({
    id: row.id,
    projectName: row.projectName,
    status: row.status,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
    contactName: contactMap.get(row.contactId) ?? '—',
    opportunityName: row.opportunityId ? (oppMap.get(row.opportunityId) ?? null) : null,
    createdAt: row.createdAt,
  }))
}

export function EngagementsDataTable({ initialData }: EngagementsDataTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<DisplayRow | null>(null)

  const { data: engagementsData } = trpc.engagements.list.useQuery(undefined, {
    initialData,
    refetchInterval: 60_000,
  })
  const { data: contactsData } = trpc.contacts.list.useQuery()
  const { data: opportunitiesData } = trpc.opportunities.list.useQuery()

  const rows = useMemo(
    () => buildDisplayRows(engagementsData?.items ?? [], contactsData, opportunitiesData),
    [engagementsData, contactsData, opportunitiesData],
  )

  const columns: ColumnDef<DisplayRow>[] = [
    {
      id: 'projectName',
      header: 'Project',
      cell: (row) => (
        <Link href={`/engagements/${row.id}`} className="font-medium text-primary hover:underline">
          {row.projectName}
        </Link>
      ),
    },
    {
      id: 'contactName',
      header: 'Contact',
      cell: (row) => (
        <Link href={`/clients/${row.contactId}`} className="text-sm hover:underline">
          {row.contactName}
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <Badge variant={statusVariant[row.status] ?? 'default'}>{row.status}</Badge>,
    },
    {
      id: 'opportunityName',
      header: 'Opportunity',
      cell: (row) =>
        row.opportunityId && row.opportunityName ? (
          <Link
            href={`/opportunities/${row.opportunityId}`}
            className="text-sm text-primary hover:underline"
          >
            {row.opportunityName}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      className: 'w-[50px]',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
              ...
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/engagements/${row.id}`}>View</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onSelect={(e) => {
                e.preventDefault()
                setDeleteTarget(row)
              }}
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CreateClientProjectDialog />
        <CreateEngagementDialog />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowKey={(row) => row.id}
        searchKey="projectName"
        searchPlaceholder="Search engagements..."
        filterKey="status"
        filterOptions={STATUS_FILTERS}
        tableLabel="Engagements"
      />
      {deleteTarget && (
        <DeleteEngagementDialog
          engagementId={deleteTarget.id}
          projectName={deleteTarget.projectName}
          contactId={deleteTarget.contactId}
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onDeleted={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

'use client'

import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import { isCaseOverdue } from '@phynd/services/cases/case-deadlines'
import type { inferRouterOutputs } from '@trpc/server'
import Link from 'next/link'
import { useState } from 'react'
import { CaseOverdueBadge, CaseStatusBadge, caseTypeLabel, formatCaseDate } from './case-labels'
import { CreateCaseDialog } from './create-case-dialog'

type CasesListOutput = inferRouterOutputs<AppRouter>['cases']['list']
type CaseRow = CasesListOutput['items'][number]

type Scope = 'unresolved' | 'all'

interface CasesDataTableProps {
  initialData: CasesListOutput
}

export function CasesDataTable({ initialData }: CasesDataTableProps) {
  const [scope, setScope] = useState<Scope>('unresolved')
  const casesRouter = trpc.cases as NonNullable<typeof trpc.cases>
  const listCases = casesRouter.list as NonNullable<typeof casesRouter.list>
  const { data } = listCases.useQuery(
    scope === 'unresolved' ? { unresolved: true, limit: 200 } : { limit: 200 },
    { initialData: scope === 'unresolved' ? initialData : undefined, refetchInterval: 60_000 },
  )
  const rows = (data as CasesListOutput | undefined)?.items ?? []
  const overdue = rows.filter((row: CaseRow) => isCaseOverdue(row)).length

  const columns: ColumnDef<CaseRow>[] = [
    {
      id: 'summary',
      header: 'Caso',
      cell: (row) => (
        <Link href={`/cases/${row.id}`} className="font-medium hover:underline">
          {row.summary.length > 80 ? `${row.summary.slice(0, 80)}…` : row.summary}
        </Link>
      ),
    },
    {
      id: 'contact',
      header: 'Contacto',
      cell: (row) =>
        row.contactName ? (
          <Link href={`/clients/${row.contactId}`} className="hover:underline">
            {row.contactName}
          </Link>
        ) : (
          '—'
        ),
    },
    { id: 'type', header: 'Tipo', cell: (row) => caseTypeLabel(row.type) },
    {
      id: 'status',
      header: 'Estado',
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <CaseStatusBadge status={row.status} />
          <CaseOverdueBadge row={row} />
        </div>
      ),
    },
    {
      id: 'dueAt',
      header: 'Fecha límite',
      cell: (row) => (
        <span className={isCaseOverdue(row) ? 'font-medium text-destructive' : 'text-sm'}>
          {formatCaseDate(row.dueAt)}
        </span>
      ),
    },
    {
      id: 'openedAt',
      header: 'Abierto',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatCaseDate(row.openedAt)}</span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-md border p-0.5 text-sm">
            {(
              [
                ['unresolved', 'Sin resolver'],
                ['all', 'Todos'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                className={`rounded px-3 py-1 ${scope === value ? 'bg-muted font-medium' : ''}`}
                aria-pressed={scope === value}
              >
                {label}
              </button>
            ))}
          </div>
          {overdue > 0 ? (
            <span className="text-sm font-medium text-destructive">
              {overdue === 1 ? '1 caso vencido' : `${String(overdue)} casos vencidos`}
            </span>
          ) : null}
        </div>
        <CreateCaseDialog />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowKey={(row) => row.id}
        searchKey="summary"
        searchPlaceholder="Buscar casos..."
      />
    </div>
  )
}

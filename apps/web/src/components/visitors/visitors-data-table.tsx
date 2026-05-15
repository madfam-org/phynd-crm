'use client'

import { Badge } from '@/components/ui/badge'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'

type SessionRow = inferRouterOutputs<AppRouter>['visitorTracking']['list'][number]

interface VisitorsDataTableProps {
  initialData: SessionRow[]
}

export function VisitorsDataTable({ initialData }: VisitorsDataTableProps) {
  const visitorTrackingRouter = trpc.visitorTracking as NonNullable<typeof trpc.visitorTracking>
  const listVisitorSessions = visitorTrackingRouter.list as NonNullable<
    typeof visitorTrackingRouter.list
  >
  const { data: sessionsData } = listVisitorSessions.useQuery(undefined, { initialData })
  const sessions = (sessionsData as SessionRow[] | undefined) ?? initialData

  const columns: ColumnDef<SessionRow>[] = [
    {
      id: 'id',
      header: 'Session',
      cell: (row) => <span className="font-mono text-xs">{row.id.slice(0, 8)}</span>,
    },
    {
      id: 'identified',
      header: 'Status',
      cell: (row) => (
        <Badge variant={row.identified ? 'success' : 'secondary'}>
          {row.identified ? 'Identified' : 'Anonymous'}
        </Badge>
      ),
    },
    {
      id: 'deviceType',
      header: 'Device',
      cell: (row) => row.deviceType ?? '—',
    },
    {
      id: 'browser',
      header: 'Browser',
      cell: (row) => row.browser ?? '—',
    },
    {
      id: 'location',
      header: 'Location',
      cell: (row) => [row.ipCity, row.ipCountry].filter(Boolean).join(', ') || '—',
    },
    {
      id: 'utmSource',
      header: 'Source',
      cell: (row) => row.utmSource ?? '—',
    },
    {
      id: 'pageViews',
      header: 'Pages',
      cell: (row) => String(row.pageViewCount),
    },
    {
      id: 'startedAt',
      header: 'Started',
      cell: (row) => new Date(row.startedAt).toLocaleString(),
    },
  ]

  return <DataTable columns={columns} data={sessions} getRowKey={(row) => row.id} />
}

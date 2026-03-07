'use client'

import { Badge } from '@/components/ui/badge'
import type { ColumnDef } from '@/components/ui/data-table'

export interface OpportunityRow {
  id: string
  name: string
  contactId: string | null
  stageId: string
  pipelineId: string
  value: string | null
  probability: number | null
  status: string
  expectedCloseDate: Date | null
}

const statusVariant: Record<string, 'default' | 'success' | 'destructive'> = {
  open: 'default',
  won: 'success',
  lost: 'destructive',
}

export const opportunityColumns: ColumnDef<OpportunityRow>[] = [
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
]

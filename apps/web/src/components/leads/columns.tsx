'use client'

import { Badge } from '@/components/ui/badge'
import type { ColumnDef } from '@/components/ui/data-table'

export interface LeadRow {
  id: string
  contactId: string | null
  source: string | null
  status: string
  score: number | null
  stageId: string
  pipelineId: string
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  new: 'default',
  contacted: 'warning',
  qualified: 'success',
  unqualified: 'secondary',
  converted: 'success',
}

export const leadColumns: ColumnDef<LeadRow>[] = [
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
  { id: 'score', header: 'Score', cell: (row) => row.score ?? '—' },
]

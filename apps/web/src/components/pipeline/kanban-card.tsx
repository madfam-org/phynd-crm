'use client'

import { Badge } from '@/components/ui/badge'

interface KanbanCardProps {
  id: string
  type: 'lead' | 'opportunity'
  title: string
  status: string
  value?: string | null
  score?: number | null
}

const statusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  new: 'default',
  contacted: 'warning',
  qualified: 'success',
  unqualified: 'secondary',
  converted: 'success',
  open: 'default',
  won: 'success',
  lost: 'destructive',
}

export function KanbanCard({ type, title, status, value, score }: KanbanCardProps) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <Badge variant={statusVariant[status] ?? 'default'}>{status}</Badge>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">
          {type}
        </Badge>
        {value && <span>${Number(value).toLocaleString()}</span>}
        {score != null && <span>Score: {score}</span>}
      </div>
    </div>
  )
}

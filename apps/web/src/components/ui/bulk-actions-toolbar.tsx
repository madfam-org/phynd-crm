'use client'

import { Button } from '@/components/ui/button'

interface BulkActionsToolbarProps {
  selectedCount: number
  onChangeStatus?: () => void
  onDelete?: () => void
  onExport?: () => void
  showStatusAction?: boolean
}

export function BulkActionsToolbar({
  selectedCount,
  onChangeStatus,
  onDelete,
  onExport,
  showStatusAction = true,
}: BulkActionsToolbarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      {showStatusAction && onChangeStatus && (
        <Button variant="outline" size="sm" onClick={onChangeStatus}>
          Change Status
        </Button>
      )}
      {onExport && (
        <Button variant="outline" size="sm" onClick={onExport}>
          Export CSV
        </Button>
      )}
      {onDelete && (
        <Button variant="destructive" size="sm" onClick={onDelete}>
          Delete Selected
        </Button>
      )}
    </div>
  )
}

import { TableSkeleton } from '@/components/ui/table-skeleton'

export default function ActivitiesLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      <TableSkeleton />
    </div>
  )
}

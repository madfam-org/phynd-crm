import { CardSkeleton } from '@/components/ui/card-skeleton'
import { TableSkeleton } from '@/components/ui/table-skeleton'

export default function OverviewLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
          <CardSkeleton key={i} />
        ))}
      </div>
      <TableSkeleton />
    </div>
  )
}

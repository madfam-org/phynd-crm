import { Skeleton } from './skeleton'

interface TableSkeletonProps {
  columns?: number
  rows?: number
}

export function TableSkeleton({ columns = 5, rows = 8 }: TableSkeletonProps) {
  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
        <div key={i} className="flex items-center gap-4 py-3">
          {Array.from({ length: columns }).map((_, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

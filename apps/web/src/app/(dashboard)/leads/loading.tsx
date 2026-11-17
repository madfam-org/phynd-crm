import { Skeleton } from '@/components/ui/skeleton'

/** Same shape as the queue: header, view tabs, tier chips, rows. */
export default function LeadsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando leads">
      <div>
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <div className="flex gap-2 border-b border-border pb-2">
        {[
          ['mine', 96],
          ['tier', 64],
          ['unassigned', 88],
          ['overdue', 168],
          ['all', 56],
        ].map(([key, width]) => (
          <Skeleton key={key} className="h-6" style={{ width }} />
        ))}
      </div>
      <div className="flex gap-1.5">
        {[
          ['any', 104],
          ['a', 56],
          ['b', 56],
          ['c', 56],
        ].map(([key, width]) => (
          <Skeleton key={key} className="h-7 rounded-full" style={{ width }} />
        ))}
      </div>
      <div className="space-y-px overflow-hidden rounded-lg border border-border">
        {['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'].map((key) => (
          <div key={key} className="flex items-center gap-4 px-3 py-3.5">
            <Skeleton className="h-5 w-24 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-80 max-w-full" />
            </div>
            <Skeleton className="hidden h-5 w-12 md:block" />
            <Skeleton className="hidden h-6 w-28 md:block" />
          </div>
        ))}
      </div>
    </div>
  )
}

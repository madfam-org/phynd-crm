import { CardSkeleton } from '@/components/ui/card-skeleton'
import { Skeleton } from '@/components/ui/skeleton'

export function FederationTabsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading federation data">
      <div className="flex flex-wrap gap-2">
        {['Overview', 'Identity', 'Billing', 'Orders', 'Fabrication'].map((label) => (
          <Skeleton key={label} className="h-9 w-24" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  )
}

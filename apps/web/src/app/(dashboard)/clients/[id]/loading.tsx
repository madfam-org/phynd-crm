import { FederationTabsSkeleton } from '@/components/federation/federation-tabs-skeleton'
import { CardSkeleton } from '@/components/ui/card-skeleton'

export default function ClientProfileLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-9 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      <CardSkeleton />
      <FederationTabsSkeleton />
      <CardSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  )
}

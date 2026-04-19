import { CardSkeleton } from '@/components/ui/card-skeleton'

export default function EngagementDetailLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-40 animate-pulse rounded bg-muted" />
      </div>
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
}

import { Card, CardContent, CardHeader } from './card'
import { Skeleton } from './skeleton'

interface CardSkeletonProps {
  hasHeader?: boolean
}

export function CardSkeleton({ hasHeader = true }: CardSkeletonProps) {
  return (
    <Card>
      {hasHeader && (
        <CardHeader>
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
      )}
      <CardContent>
        <Skeleton className="h-8 w-1/4" />
      </CardContent>
    </Card>
  )
}

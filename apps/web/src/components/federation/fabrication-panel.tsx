import { Badge } from '@/components/ui/badge'
import type { PravaraFabrication } from '@phyne/types/federation'

interface FabricationPanelProps {
  data: PravaraFabrication
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  queued: 'default',
  in_progress: 'warning',
  quality_check: 'warning',
  completed: 'success',
  delayed: 'destructive',
  cancelled: 'destructive',
}

export function FabricationPanel({ data }: FabricationPanelProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2 text-center text-sm">
        <div>
          <p className="text-lg font-bold">{data.summary.total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
        <div>
          <p className="text-lg font-bold text-yellow-600">{data.summary.inProgress}</p>
          <p className="text-xs text-muted-foreground">In Progress</p>
        </div>
        <div>
          <p className="text-lg font-bold text-green-600">{data.summary.completed}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </div>
        <div>
          <p className="text-lg font-bold text-red-600">{data.summary.delayed}</p>
          <p className="text-xs text-muted-foreground">Delayed</p>
        </div>
      </div>
      {data.orders.length > 0 && (
        <div className="space-y-2">
          {data.orders.slice(0, 5).map((order) => (
            <div
              key={order.orderId}
              className="flex items-center justify-between rounded border p-2 text-sm"
            >
              <div>
                <p className="font-medium">{order.productName}</p>
                <p className="text-xs text-muted-foreground">
                  Step {order.completedSteps}/{order.totalSteps}: {order.currentStep}
                </p>
              </div>
              <Badge variant={statusVariant[order.status] ?? 'default'}>{order.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

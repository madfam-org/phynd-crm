import { Badge } from '@/components/ui/badge'
import type { CotizaManufacturing } from '@phyne/types/federation'

interface ManufacturingPanelProps {
  data: CotizaManufacturing
}

export function ManufacturingPanel({ data }: ManufacturingPanelProps) {
  return (
    <div className="space-y-3">
      {data.orders.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">Orders ({data.orders.length})</p>
          <div className="space-y-2">
            {data.orders.slice(0, 5).map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between rounded border p-2 text-sm"
              >
                <div>
                  <p className="font-medium">{order.productName}</p>
                  <p className="text-xs text-muted-foreground">Qty: {order.quantity}</p>
                </div>
                <div className="text-right">
                  <Badge variant={order.status === 'completed' ? 'success' : 'default'}>
                    {order.status}
                  </Badge>
                  <p className="mt-1 text-xs text-muted-foreground">{order.progress}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.activeQuotes.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">Active Quotes ({data.activeQuotes.length})</p>
          <div className="space-y-1">
            {data.activeQuotes.slice(0, 3).map((quote) => (
              <div key={quote.id} className="flex items-center justify-between text-sm">
                <span>
                  {quote.currency} {quote.totalAmount.toLocaleString()}
                </span>
                <Badge variant={quote.status === 'accepted' ? 'success' : 'outline'}>
                  {quote.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.orders.length === 0 && data.activeQuotes.length === 0 && (
        <p className="text-sm text-muted-foreground">No orders or quotes.</p>
      )}
    </div>
  )
}

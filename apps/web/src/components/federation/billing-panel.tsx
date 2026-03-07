import { Badge } from '@/components/ui/badge'
import type { DhanamBilling } from '@phyne/types/federation'

interface BillingPanelProps {
  data: DhanamBilling
}

export function BillingPanel({ data }: BillingPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Plan</p>
          <p className="font-medium">{data.plan}</p>
        </div>
        <Badge variant={data.status === 'active' ? 'success' : 'warning'}>{data.status}</Badge>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">Balance</p>
        <p className="text-lg font-semibold">
          {data.currency} {data.currentBalance.toLocaleString()}
        </p>
      </div>
      {data.invoices.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">Recent Invoices</p>
          <div className="space-y-1">
            {data.invoices.slice(0, 3).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between text-sm">
                <span>
                  {inv.currency} {inv.amount.toLocaleString()}
                </span>
                <Badge variant={inv.status === 'paid' ? 'success' : 'warning'} className="text-xs">
                  {inv.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.paymentMethods.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">Payment Methods</p>
          <div className="space-y-1">
            {data.paymentMethods.map((pm) => (
              <div key={pm.id} className="flex items-center gap-2 text-sm">
                <span>
                  {pm.type} **** {pm.last4}
                </span>
                {pm.isDefault && (
                  <Badge variant="outline" className="text-xs">
                    Default
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

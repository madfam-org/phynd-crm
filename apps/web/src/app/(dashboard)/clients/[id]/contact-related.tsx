'use client'

import { Badge } from '@/components/ui/badge'
import { trpc } from '@/lib/trpc/client'

interface ContactRelatedProps {
  contactId: string
}

const LEAD_STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'success' | 'warning' | 'error'
> = {
  converted: 'success',
  qualified: 'success',
  contacted: 'default',
  new: 'secondary',
  unqualified: 'error',
}

const OPP_STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'success' | 'warning' | 'error'
> = {
  open: 'default',
  won: 'success',
  lost: 'error',
}

const QUOTE_STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'success' | 'warning' | 'error'
> = {
  accepted: 'success',
  declined: 'error',
  draft: 'secondary',
  expired: 'warning',
  sent: 'default',
}

const ORDER_STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'success' | 'warning' | 'error'
> = {
  cancelled: 'error',
  confirmed: 'default',
  fulfilled: 'success',
  in_production: 'warning',
  pending: 'secondary',
}

export function ContactRelated({ contactId }: ContactRelatedProps) {
  const { data: leadsData } = trpc.leads.listByContactId.useQuery({ contactId })
  const { data: oppsData } = trpc.opportunities.listByContactId.useQuery({ contactId })
  const { data: quotesData } = trpc.quotes.listByContactId.useQuery({ contactId })
  const { data: ordersData } = trpc.orders.listByContactId.useQuery({ contactId })

  const leads = leadsData?.items ?? []
  const opportunities = oppsData?.items ?? []
  const quotes = quotesData?.items ?? []
  const orders = ordersData?.items ?? []

  return (
    <div className="space-y-6">
      {/* Related Leads */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Related Leads</h3>
        {leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No related leads.</p>
        ) : (
          <div className="space-y-2">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {lead.source && <span className="text-sm font-medium">{lead.source}</span>}
                    {lead.score !== null && lead.score !== undefined && (
                      <span className="text-xs text-muted-foreground">Score: {lead.score}</span>
                    )}
                  </div>
                </div>
                <Badge variant={LEAD_STATUS_VARIANT[lead.status] ?? 'secondary'}>
                  {lead.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Related Opportunities */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Related Opportunities</h3>
        {opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No related opportunities.</p>
        ) : (
          <div className="space-y-2">
            {opportunities.map((opp) => (
              <div key={opp.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{opp.name}</span>
                    {opp.value && (
                      <span className="text-xs text-muted-foreground">
                        ${Number(opp.value).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <Badge variant={OPP_STATUS_VARIANT[opp.status] ?? 'secondary'}>{opp.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Related Quotes */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Related Quotes</h3>
        {quotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No related quotes.</p>
        ) : (
          <div className="space-y-2">
            {quotes.map((quote) => (
              <div key={quote.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{quote.quoteNumber}</span>
                    {quote.totalAmount && (
                      <span className="text-xs text-muted-foreground">
                        ${Number(quote.totalAmount).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <Badge variant={QUOTE_STATUS_VARIANT[quote.status] ?? 'secondary'}>{quote.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Related Orders */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Related Orders</h3>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No related orders.</p>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => (
              <div key={order.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{order.orderNumber}</span>
                    {order.totalAmount && (
                      <span className="text-xs text-muted-foreground">
                        ${Number(order.totalAmount).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? 'secondary'}>
                  {order.status.replace('_', ' ')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

import { NotesPanel } from '@/components/notes/notes-panel'
import { TagsPanel } from '@/components/tags/tags-panel'
import { EntityTimeline } from '@/components/timeline/entity-timeline'
import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

interface QuoteDetailPageProps {
  params: Promise<{ id: string }>
}

const statusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  accepted: 'success',
  declined: 'destructive',
  draft: 'secondary',
  expired: 'warning',
  sent: 'default',
}

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { id } = await params
  const caller = await getServerCaller()

  const quote = await caller.quotes.getById({ id })
  if (!quote) notFound()

  const [contact, opportunity, relatedOrders] = await Promise.all([
    quote.contactId ? caller.contacts.getById({ id: quote.contactId }) : null,
    quote.opportunityId ? caller.opportunities.getById({ id: quote.opportunityId }) : null,
    caller.orders.listByQuoteId({ quoteId: id }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Quote {quote.quoteNumber}</h1>
        <p className="text-muted-foreground">Quote Detail</p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-sm text-muted-foreground">Amount</span>
            <p className="text-xl font-bold">
              {quote.totalAmount ? `$${Number(quote.totalAmount).toLocaleString()}` : '—'}
            </p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Currency</span>
            <p className="font-medium">{quote.currency}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Status</span>
            <div className="mt-1">
              <Badge variant={statusVariant[quote.status] ?? 'default'}>{quote.status}</Badge>
            </div>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Valid Until</span>
            <p className="font-medium">
              {quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : '—'}
            </p>
          </div>
          {opportunity && (
            <div>
              <span className="text-sm text-muted-foreground">Opportunity</span>
              <p className="font-medium">
                <Link
                  href={`/opportunities/${opportunity.id}`}
                  className="text-primary hover:underline"
                >
                  {opportunity.name}
                </Link>
              </p>
            </div>
          )}
          {contact && (
            <div>
              <span className="text-sm text-muted-foreground">Contact</span>
              <p className="font-medium">
                <Link href={`/clients/${contact.id}`} className="text-primary hover:underline">
                  {contact.name}
                </Link>
              </p>
            </div>
          )}
          <div>
            <span className="text-sm text-muted-foreground">Created</span>
            <p className="font-medium">{new Date(quote.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {relatedOrders.items.length > 0 && (
        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">Related Orders</h3>
          <div className="space-y-2">
            {relatedOrders.items.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/orders/${order.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    {order.totalAmount && (
                      <span className="text-xs text-muted-foreground">
                        ${Number(order.totalAmount).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <Badge variant="secondary">{order.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Timeline</h3>
            <EntityTimeline entityType="quote" entityId={id} />
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Notes</h3>
            <NotesPanel entityType="quote" entityId={id} />
          </div>
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Tags</h3>
            <TagsPanel entityType="quote" entityId={id} />
          </div>
        </div>
      </div>
    </div>
  )
}

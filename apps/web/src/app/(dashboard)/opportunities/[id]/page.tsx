import { NotesPanel } from '@/components/notes/notes-panel'
import { TagsPanel } from '@/components/tags/tags-panel'
import { EntityTimeline } from '@/components/timeline/entity-timeline'
import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

interface OpportunityDetailPageProps {
  params: Promise<{ id: string }>
}

const statusVariant: Record<string, 'default' | 'success' | 'destructive'> = {
  open: 'default',
  won: 'success',
  lost: 'destructive',
}

export default async function OpportunityDetailPage({ params }: OpportunityDetailPageProps) {
  const { id } = await params
  const caller = await getServerCaller()

  const opp = await caller.opportunities.getById({ id })
  if (!opp) notFound()

  const [contact, stages, relatedQuotes, relatedOrders] = await Promise.all([
    opp.contactId ? caller.contacts.getById({ id: opp.contactId }) : null,
    opp.pipelineId ? caller.pipelines.getStages({ pipelineId: opp.pipelineId }) : [],
    caller.quotes.listByOpportunityId({ opportunityId: id }),
    caller.orders.listByOpportunityId({ opportunityId: id }),
  ])

  type PipelineStage = (typeof stages)[number]
  type RelatedQuote = (typeof relatedQuotes.items)[number]
  type RelatedOrder = (typeof relatedOrders.items)[number]
  const stageName = stages.find((s: PipelineStage) => s.id === opp.stageId)?.name ?? null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{opp.name}</h1>
        <p className="text-muted-foreground">Opportunity Detail</p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-sm text-muted-foreground">Value</span>
            <p className="text-xl font-bold">
              {opp.value ? `$${Number(opp.value).toLocaleString()}` : '—'}
            </p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Probability</span>
            <p className="font-medium">{opp.probability != null ? `${opp.probability}%` : '—'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Status</span>
            <div className="mt-1">
              <Badge variant={statusVariant[opp.status] ?? 'default'}>{opp.status}</Badge>
            </div>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Stage</span>
            <p className="font-medium">{stageName ?? '—'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Expected Close</span>
            <p className="font-medium">
              {opp.expectedCloseDate ? new Date(opp.expectedCloseDate).toLocaleDateString() : '—'}
            </p>
          </div>
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
            <p className="font-medium">{new Date(opp.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {(relatedQuotes.items.length > 0 || relatedOrders.items.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {relatedQuotes.items.length > 0 && (
            <div className="rounded-lg border bg-card p-6">
              <h3 className="mb-4 text-lg font-semibold">Related Quotes</h3>
              <div className="space-y-2">
                {relatedQuotes.items.map((quote: RelatedQuote) => (
                  <div
                    key={quote.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/quotes/${quote.id}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          {quote.quoteNumber}
                        </Link>
                        {quote.totalAmount && (
                          <span className="text-xs text-muted-foreground">
                            ${Number(quote.totalAmount).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant={quote.status === 'accepted' ? 'success' : 'default'}>
                      {quote.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
          {relatedOrders.items.length > 0 && (
            <div className="rounded-lg border bg-card p-6">
              <h3 className="mb-4 text-lg font-semibold">Related Orders</h3>
              <div className="space-y-2">
                {relatedOrders.items.map((order: RelatedOrder) => (
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
                    <Badge variant={order.status === 'fulfilled' ? 'success' : 'default'}>
                      {order.status.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Timeline</h3>
            <EntityTimeline entityType="opportunity" entityId={id} />
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Notes</h3>
            <NotesPanel entityType="opportunity" entityId={id} />
          </div>
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Tags</h3>
            <TagsPanel entityType="opportunity" entityId={id} />
          </div>
        </div>
      </div>
    </div>
  )
}

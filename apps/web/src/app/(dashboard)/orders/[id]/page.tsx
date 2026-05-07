import { NotesPanel } from '@/components/notes/notes-panel'
import { TagsPanel } from '@/components/tags/tags-panel'
import { EntityTimeline } from '@/components/timeline/entity-timeline'
import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

interface OrderDetailPageProps {
  params: Promise<{ id: string }>
}

const statusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  cancelled: 'destructive',
  confirmed: 'default',
  fulfilled: 'success',
  in_production: 'warning',
  pending: 'secondary',
}

const paymentStatusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  paid: 'success',
  partial: 'warning',
  refunded: 'destructive',
  unpaid: 'secondary',
}

function formatMoney(value: string | null) {
  return value ? `$${Number(value).toLocaleString()}` : '—'
}

function formatDate(value: Date | string | null) {
  return value ? new Date(value).toLocaleDateString() : '—'
}

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { id } = await params
  const caller = await getServerCaller()

  const order = await caller.orders.getById({ id })
  if (!order) notFound()

  const [contact, opportunity, quote] = await Promise.all([
    order.contactId ? caller.contacts.getById({ id: order.contactId }) : null,
    order.opportunityId ? caller.opportunities.getById({ id: order.opportunityId }) : null,
    order.quoteId ? caller.quotes.getById({ id: order.quoteId }) : null,
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Order {order.orderNumber}</h1>
        <p className="text-muted-foreground">Order Detail</p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-sm text-muted-foreground">Amount</span>
            <p className="text-xl font-bold">{formatMoney(order.totalAmount)}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Currency</span>
            <p className="font-medium">{order.currency}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Status</span>
            <div className="mt-1">
              <Badge variant={statusVariant[order.status] ?? 'default'}>
                {order.status.replace('_', ' ')}
              </Badge>
            </div>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Payment</span>
            <div className="mt-1">
              <Badge variant={paymentStatusVariant[order.paymentStatus] ?? 'default'}>
                {order.paymentStatus.replace('_', ' ')}
              </Badge>
            </div>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Est. Completion</span>
            <p className="font-medium">{formatDate(order.estimatedCompletion)}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Paid Amount</span>
            <p className="font-medium">{formatMoney(order.paidAmount)}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Paid At</span>
            <p className="font-medium">{formatDate(order.paidAt)}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Payment Provider</span>
            <p className="font-medium">{order.paymentProvider ?? '—'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">External Payment</span>
            <p className="font-medium">{order.externalPaymentId ?? '—'}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Actual Completion</span>
            <p className="font-medium">{formatDate(order.actualCompletion)}</p>
          </div>
          {quote && (
            <div>
              <span className="text-sm text-muted-foreground">Quote</span>
              <p className="font-medium">
                <Link href={`/quotes/${quote.id}`} className="text-primary hover:underline">
                  {quote.quoteNumber}
                </Link>
              </p>
            </div>
          )}
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
            <p className="font-medium">{formatDate(order.createdAt)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Timeline</h3>
            <EntityTimeline entityType="order" entityId={id} />
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Notes</h3>
            <NotesPanel entityType="order" entityId={id} />
          </div>
          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Tags</h3>
            <TagsPanel entityType="order" entityId={id} />
          </div>
        </div>
      </div>
    </div>
  )
}

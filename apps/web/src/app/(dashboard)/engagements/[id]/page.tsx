import { DeleteEngagementButton } from '@/components/engagements/delete-engagement-button'
import { EngagementDetailTabs } from '@/components/engagements/engagement-detail-tabs'
import { PublishQuoteAndPortalButton } from '@/components/engagements/publish-quote-and-portal-button'
import { SendPortalLinkButton } from '@/components/engagements/send-portal-link-button'
import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

interface EngagementDetailPageProps {
  params: Promise<{ id: string }>
}

const statusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  active: 'default',
  completed: 'success',
  paused: 'warning',
  cancelled: 'destructive',
}

export default async function EngagementDetailPage({ params }: EngagementDetailPageProps) {
  const { id } = await params
  const caller = await getServerCaller()

  const engagement = await caller.engagements.getById({ id })
  if (!engagement) notFound()

  const [contact, opportunity] = await Promise.all([
    caller.contacts.getById({ id: engagement.contactId }),
    engagement.opportunityId
      ? caller.opportunities.getById({ id: engagement.opportunityId })
      : null,
  ])

  const contactHasEmail = Boolean(contact?.email)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold">{engagement.projectName}</h1>
          <p className="text-muted-foreground">Engagement detail</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PublishQuoteAndPortalButton engagementId={engagement.id} disabled={!contactHasEmail} />
          <SendPortalLinkButton engagementId={engagement.id} disabled={!contactHasEmail} />
          <DeleteEngagementButton
            engagementId={engagement.id}
            projectName={engagement.projectName}
            contactId={engagement.contactId}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-sm text-muted-foreground">Status</span>
            <div className="mt-1">
              <Badge variant={statusVariant[engagement.status] ?? 'default'}>
                {engagement.status}
              </Badge>
            </div>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Contact</span>
            <p className="font-medium">
              {contact ? (
                <Link href={`/clients/${contact.id}`} className="text-primary hover:underline">
                  {contact.name}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            {contact?.email && <p className="text-xs text-muted-foreground">{contact.email}</p>}
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Opportunity</span>
            <p className="font-medium">
              {opportunity ? (
                <Link
                  href={`/opportunities/${opportunity.id}`}
                  className="text-primary hover:underline"
                >
                  {opportunity.name}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Created</span>
            <p className="font-medium">{new Date(engagement.createdAt).toLocaleDateString()}</p>
          </div>
          {engagement.description && (
            <div className="sm:col-span-2 lg:col-span-4">
              <span className="text-sm text-muted-foreground">Description</span>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900 dark:text-slate-100">
                {engagement.description}
              </p>
            </div>
          )}
        </div>
        {!contactHasEmail && (
          <p className="mt-4 text-xs text-warning-foreground">
            The linked contact has no email on file, so the portal magic-link cannot be sent.
          </p>
        )}
      </div>

      <EngagementDetailTabs
        engagement={{
          id: engagement.id,
          projectName: engagement.projectName,
          description: engagement.description,
          status: engagement.status,
          ownerId: engagement.ownerId,
        }}
      />
    </div>
  )
}

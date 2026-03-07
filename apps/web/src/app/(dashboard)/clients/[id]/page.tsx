import { Suspense } from 'react'
import { FederationPanel } from '@/components/federation/federation-panel'
import { FederationErrorBoundary } from '@/components/federation/error-boundary'
import { isFeatureEnabled } from '@phyne/config/features'

interface ClientProfilePageProps {
  params: Promise<{ id: string }>
}

export default async function ClientProfilePage({ params }: ClientProfilePageProps) {
  const { id } = await params

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Client Profile</h1>
        <p className="text-muted-foreground">Unified view across all systems</p>
      </div>

      {/* Profile Header - from local DB */}
      <div className="rounded-lg border bg-card p-6">
        <p className="text-sm text-muted-foreground">Contact ID: {id}</p>
      </div>

      {/* Federation Panels - each with independent Suspense + Error boundary */}
      <div className="grid gap-4 lg:grid-cols-2">
        <FederationErrorBoundary provider="janua">
          <Suspense fallback={<PanelSkeleton title="Identity" />}>
            <FederationPanel provider="janua" contactId={id} title="Identity" />
          </Suspense>
        </FederationErrorBoundary>

        <FederationErrorBoundary provider="dhanam">
          <Suspense fallback={<PanelSkeleton title="Billing" />}>
            <FederationPanel provider="dhanam" contactId={id} title="Billing" />
          </Suspense>
        </FederationErrorBoundary>

        <FederationErrorBoundary provider="cotiza">
          <Suspense fallback={<PanelSkeleton title="Custom Orders" />}>
            <FederationPanel provider="cotiza" contactId={id} title="Custom Orders" />
          </Suspense>
        </FederationErrorBoundary>

        <FederationErrorBoundary provider="pravara">
          <Suspense fallback={<PanelSkeleton title="Fabrication" />}>
            <FederationPanel provider="pravara" contactId={id} title="Fabrication" />
          </Suspense>
        </FederationErrorBoundary>

        {isFeatureEnabled('forjEnabled') && (
          <FederationErrorBoundary provider="forj">
            <Suspense fallback={<PanelSkeleton title="Assets" />}>
              <FederationPanel provider="forj" contactId={id} title="Assets" />
            </Suspense>
          </FederationErrorBoundary>
        )}
      </div>
    </div>
  )
}

function PanelSkeleton({ title }: { title: string }) {
  return (
    <div className="rounded-lg border bg-card p-6 animate-pulse">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <div className="mt-4 space-y-2">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-4 w-1/2 rounded bg-muted" />
        <div className="h-4 w-2/3 rounded bg-muted" />
      </div>
    </div>
  )
}

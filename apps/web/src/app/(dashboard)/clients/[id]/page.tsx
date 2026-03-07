import { FederationErrorBoundary } from '@/components/federation/error-boundary'
import { FederationPanel } from '@/components/federation/federation-panel'
import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'
import { isFeatureEnabled } from '@phyne/config/features'

interface ClientProfilePageProps {
  params: Promise<{ id: string }>
}

export default async function ClientProfilePage({ params }: ClientProfilePageProps) {
  const { id } = await params
  const caller = await getServerCaller()

  let profile: Awaited<ReturnType<typeof caller.unifiedProfile.getProfile>> | null = null
  let profileError: string | null = null

  try {
    profile = await caller.unifiedProfile.getProfile({ contactId: id })
  } catch (err) {
    profileError = err instanceof Error ? err.message : 'Failed to load profile'
  }

  const contact = profile?.contact

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Client Profile</h1>
        <p className="text-muted-foreground">Unified view across all systems</p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        {contact ? (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{contact.name}</h2>
              <p className="text-sm text-muted-foreground">
                {contact.email} {contact.company && `| ${contact.company}`}
              </p>
            </div>
            <Badge variant={contact.status === 'active' ? 'success' : 'secondary'}>
              {contact.status}
            </Badge>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{profileError ?? `Contact ID: ${id}`}</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FederationErrorBoundary provider="janua">
          <FederationPanel
            provider="janua"
            title="Identity"
            status={profile?.federationStatus?.janua ?? 'unavailable'}
            data={profile?.identity?.data ?? null}
            error={profile?.identity?.error ?? null}
            cachedAt={profile?.identity?.cachedAt ?? null}
          />
        </FederationErrorBoundary>

        <FederationErrorBoundary provider="dhanam">
          <FederationPanel
            provider="dhanam"
            title="Billing"
            status={profile?.federationStatus?.dhanam ?? 'unavailable'}
            data={profile?.billing?.data ?? null}
            error={profile?.billing?.error ?? null}
            cachedAt={profile?.billing?.cachedAt ?? null}
          />
        </FederationErrorBoundary>

        <FederationErrorBoundary provider="cotiza">
          <FederationPanel
            provider="cotiza"
            title="Custom Orders"
            status={profile?.federationStatus?.cotiza ?? 'unavailable'}
            data={profile?.manufacturing?.data ?? null}
            error={profile?.manufacturing?.error ?? null}
            cachedAt={profile?.manufacturing?.cachedAt ?? null}
          />
        </FederationErrorBoundary>

        <FederationErrorBoundary provider="pravara">
          <FederationPanel
            provider="pravara"
            title="Fabrication"
            status={profile?.federationStatus?.pravara ?? 'unavailable'}
            data={profile?.fabrication?.data ?? null}
            error={profile?.fabrication?.error ?? null}
            cachedAt={profile?.fabrication?.cachedAt ?? null}
          />
        </FederationErrorBoundary>

        {isFeatureEnabled('forjEnabled') && (
          <FederationErrorBoundary provider="forj">
            <FederationPanel
              provider="forj"
              title="Assets"
              status={profile?.federationStatus?.forj ?? 'unavailable'}
              data={profile?.assets?.data ?? null}
              error={profile?.assets?.error ?? null}
              cachedAt={profile?.assets?.cachedAt ?? null}
            />
          </FederationErrorBoundary>
        )}
      </div>
    </div>
  )
}

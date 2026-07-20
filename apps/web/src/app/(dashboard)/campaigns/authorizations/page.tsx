import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getServerCaller } from '@/lib/trpc/server'
import type { CampaignAuthorizationSnapshot } from '@phynd/services'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('es-MX', { dateStyle: 'medium' })
}

export default async function CampaignAuthorizationsPage() {
  const caller = await getServerCaller()
  const [pending, decided] = await Promise.all([
    caller.campaignAuthorizations.listPending(),
    caller.campaignAuthorizations.listRecentDecided({ limit: 20 }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ShieldCheck className="h-7 w-7 text-primary" />
          Campaign Authorizations
        </h1>
        <p className="text-muted-foreground">
          The final human gate: no campaign can send without an explicit owner authorization of its
          exact content, audience, and schedule.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Pending review
          {pending.length > 0 && (
            <Badge variant="warning" className="ml-2 align-middle">
              {pending.length}
            </Badge>
          )}
        </h2>

        {pending.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No campaigns are waiting for authorization.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pending.map(({ authorization, campaign }) => {
              const snapshot = authorization.snapshot as unknown as CampaignAuthorizationSnapshot
              const coverage = snapshot.context?.coverage
              const variantCount = snapshot.payload?.variants?.length ?? 0
              const languages = [
                ...new Set(
                  (snapshot.payload?.variants ?? [])
                    .map((variant) => variant.language)
                    .filter((language): language is string => Boolean(language)),
                ),
              ]
              return (
                <Card key={authorization.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{campaign.name}</CardTitle>
                        <CardDescription>
                          Requested {formatDateTime(authorization.createdAt)} by{' '}
                          {authorization.requestedBy}
                        </CardDescription>
                      </div>
                      <Badge variant="warning">pending</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {campaign.skuKey && <Badge variant="outline">{campaign.skuKey}</Badge>}
                      <Badge variant="secondary">
                        {variantCount} variant{variantCount !== 1 ? 's' : ''}
                      </Badge>
                      {languages.map((language) => (
                        <Badge key={language} variant="secondary">
                          {language}
                        </Badge>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="mt-auto flex items-end justify-between gap-3 pt-0">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">Sendable today</dt>
                      <dd className="font-medium tabular-nums">
                        {coverage
                          ? `${coverage.grantedNotSuppressed.toLocaleString('es-MX')} of ${coverage.contactsWithEmail.toLocaleString('es-MX')}`
                          : '—'}
                      </dd>
                      <dt className="text-muted-foreground">Send window</dt>
                      <dd className="font-medium">
                        {campaign.startDate || campaign.endDate
                          ? `${formatDate(campaign.startDate)} – ${formatDate(campaign.endDate)}`
                          : 'Not scheduled'}
                      </dd>
                    </dl>
                    <Button asChild size="sm">
                      <Link href={`/campaigns/authorizations/${authorization.id}`}>
                        Review
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Decision history</h2>
        {decided.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {decided.map(({ authorization, campaign }) => (
              <Link
                key={authorization.id}
                href={`/campaigns/authorizations/${authorization.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
              >
                <Badge
                  variant={authorization.status === 'authorized' ? 'success' : 'error'}
                  className="w-24 justify-center"
                >
                  {authorization.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-medium">{campaign.name}</span>
                <span className="text-muted-foreground">
                  {authorization.decidedBy}
                  {authorization.decidedVia && (
                    <Badge variant="outline" className="ml-2 text-[10px] uppercase">
                      via {authorization.decidedVia}
                    </Badge>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {formatDateTime(authorization.decidedAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

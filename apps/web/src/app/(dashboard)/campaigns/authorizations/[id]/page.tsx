import { DecisionPanel } from '@/components/campaigns/authorizations/decision-panel'
import {
  type RenderedVariant,
  VariantPreviewTabs,
} from '@/components/campaigns/authorizations/variant-preview-tabs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { getServerCaller } from '@/lib/trpc/server'
import { TRPCError } from '@trpc/server'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface AuthorizationReviewPageProps {
  params: Promise<{ id: string }>
}

const statusVariant: Record<string, 'warning' | 'success' | 'error' | 'secondary'> = {
  pending: 'warning',
  authorized: 'success',
  rejected: 'error',
  superseded: 'secondary',
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

function CoverageRow({
  label,
  value,
  emphasis,
}: {
  label: string
  value: number
  emphasis?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={emphasis ? 'font-medium' : 'text-muted-foreground'}>{label}</dt>
      <dd className={`tabular-nums ${emphasis ? 'text-lg font-semibold' : 'font-medium'}`}>
        {value.toLocaleString('es-MX')}
      </dd>
    </div>
  )
}

export default async function AuthorizationReviewPage({ params }: AuthorizationReviewPageProps) {
  const { id } = await params
  const caller = await getServerCaller()

  const preview = await caller.campaignAuthorizations.getPreview({ id }).catch((error) => {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') return null
    throw error
  })
  if (!preview) notFound()

  const { authorization, snapshot, rendered, stale } = preview
  const payload = snapshot.payload
  const context = snapshot.context
  const coverage = context.coverage
  const isPending = authorization.status === 'pending'

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/campaigns/authorizations"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Campaign Authorizations
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{payload.name}</h1>
          <Badge variant={statusVariant[authorization.status] ?? 'secondary'}>
            {authorization.status}
          </Badge>
          {payload.skuKey && <Badge variant="outline">{payload.skuKey}</Badge>}
          {context.gaReadiness && (
            <Badge variant={context.gaReadiness === 'ready' ? 'success' : 'warning'}>
              GA: {context.gaReadiness.replace('_', ' ')}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Snapshot captured {formatDateTime(context.capturedAt)} · requested by{' '}
          {authorization.requestedBy}
          {context.orchestrator && <> · orchestrated by {context.orchestrator}</>}
        </p>
      </div>

      {isPending && stale && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The campaign content changed after this snapshot was taken. This request can no longer
            be authorized — create a fresh review from the panel on the right.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Email preview — exactly what ships</CardTitle>
            </CardHeader>
            <CardContent>
              <VariantPreviewTabs variants={rendered as RenderedVariant[]} />
            </CardContent>
          </Card>

          {payload.guardrailsDoNotClaim.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-900">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-amber-950 dark:text-amber-100">
                  Guardrails — never claim
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900 dark:text-amber-200">
                  {payload.guardrailsDoNotClaim.map((claim) => (
                    <li key={claim}>{claim}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {context.proofPoints.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Proof points grounding this copy</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {context.proofPoints.map((point) => (
                    <li key={`${point.label}-${point.value}`}>
                      <span className="font-medium">{point.label}:</span>{' '}
                      <span className="text-muted-foreground">{point.value}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What you are authorizing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="space-y-2.5">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Sender
                  </dt>
                  <dd className="mt-0.5 font-medium">{payload.sender}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Channel
                  </dt>
                  <dd className="mt-0.5 font-medium">{payload.channel}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Send window
                  </dt>
                  <dd className="mt-0.5 font-medium">
                    {payload.schedule.startDate || payload.schedule.endDate
                      ? `${formatDateTime(payload.schedule.startDate)} – ${formatDateTime(payload.schedule.endDate)}`
                      : 'Not scheduled'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Audience
                  </dt>
                  <dd className="mt-0.5 font-medium">
                    {payload.audienceDefinition ?? 'Not defined on the import'}
                  </dd>
                </div>
                {payload.privacyUrl && (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Aviso de Privacidad
                    </dt>
                    <dd className="mt-0.5 break-all font-medium">{payload.privacyUrl}</dd>
                  </div>
                )}
              </dl>

              <Separator />

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Consent coverage at snapshot
                </p>
                <dl className="mt-2 space-y-1.5">
                  <CoverageRow label="Contacts with email" value={coverage.contactsWithEmail} />
                  <CoverageRow label="Consent granted" value={coverage.consent.granted} />
                  <CoverageRow
                    label="Pending double opt-in"
                    value={coverage.consent.pendingDoubleOptIn}
                  />
                  <CoverageRow label="Consent revoked" value={coverage.consent.revoked} />
                  <CoverageRow label="Suppressed" value={coverage.suppressed} />
                  <Separator className="my-1" />
                  <CoverageRow
                    label="Sendable today"
                    value={coverage.grantedNotSuppressed}
                    emphasis
                  />
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  Real counts from the consent ledger, captured {formatDateTime(context.capturedAt)}
                  . Every contact is re-checked against consent and suppression at send time;
                  suppression always wins.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {isPending ? 'Your decision' : 'Decision record'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <DecisionPanel
                  authorizationId={authorization.id}
                  campaignId={authorization.campaignId}
                  campaignName={payload.name}
                  stale={stale}
                />
              ) : (
                <dl className="space-y-2.5 text-sm">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Decided by
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {authorization.decidedBy ?? '—'}
                      {authorization.decidedVia && (
                        <Badge variant="outline" className="ml-2 text-[10px] uppercase">
                          via {authorization.decidedVia}
                        </Badge>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Decided at
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {formatDateTime(authorization.decidedAt)}
                    </dd>
                  </div>
                  {authorization.decisionNote && (
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Note
                      </dt>
                      <dd className="mt-0.5 whitespace-pre-wrap">{authorization.decisionNote}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Payload hash
                    </dt>
                    <dd className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                      {authorization.payloadHash}
                    </dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

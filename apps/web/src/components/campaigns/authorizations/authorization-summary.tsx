import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { CampaignAuthorizationContext, CampaignAuthorizationPayload } from '@phynd/services'

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  )
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

/**
 * The "what you are authorizing" sidebar: sender/channel/schedule/audience
 * exactly as frozen in the snapshot, plus the consent coverage captured at
 * request time. Presentational only — every number comes from the immutable
 * snapshot.
 */
export function AuthorizationSummary({
  payload,
  context,
}: {
  payload: CampaignAuthorizationPayload
  context: CampaignAuthorizationContext
}) {
  const { coverage } = context
  const window =
    payload.schedule.startDate || payload.schedule.endDate
      ? `${formatDateTime(payload.schedule.startDate)} – ${formatDateTime(payload.schedule.endDate)}`
      : 'Not scheduled'

  return (
    <div className="space-y-4 text-sm">
      <dl className="space-y-2.5">
        <Field label="Sender">{payload.sender}</Field>
        <Field label="Channel">{payload.channel}</Field>
        <Field label="Send window">{window}</Field>
        <Field label="Audience">{payload.audienceDefinition ?? 'Not defined on the import'}</Field>
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
          <CoverageRow label="Pending double opt-in" value={coverage.consent.pendingDoubleOptIn} />
          <CoverageRow label="Consent revoked" value={coverage.consent.revoked} />
          <CoverageRow label="Suppressed" value={coverage.suppressed} />
          <Separator className="my-1" />
          <CoverageRow label="Sendable today" value={coverage.grantedNotSuppressed} emphasis />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Real counts from the consent ledger, captured {formatDateTime(context.capturedAt)}. Every
          contact is re-checked against consent and suppression at send time; suppression always
          wins.
        </p>
      </div>
    </div>
  )
}

type DecisionRecordProps = {
  decidedBy: string | null
  decidedVia: string | null
  decidedAt: Date | string | null
  decisionNote: string | null
  payloadHash: string
}

/** Read-only decision record shown once an authorization has been decided. */
export function DecisionRecord({
  decidedBy,
  decidedVia,
  decidedAt,
  decisionNote,
  payloadHash,
}: DecisionRecordProps) {
  return (
    <dl className="space-y-2.5 text-sm">
      <Field label="Decided by">
        {decidedBy ?? '—'}
        {decidedVia && (
          <Badge variant="outline" className="ml-2 text-[10px] uppercase">
            via {decidedVia}
          </Badge>
        )}
      </Field>
      <Field label="Decided at">{formatDateTime(decidedAt)}</Field>
      {decisionNote && (
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Note
          </dt>
          <dd className="mt-0.5 whitespace-pre-wrap">{decisionNote}</dd>
        </div>
      )}
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Payload hash
        </dt>
        <dd className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{payloadHash}</dd>
      </div>
    </dl>
  )
}

import { Badge } from '@/components/ui/badge'
import type { KarafielComplianceSummary } from '@phynd/types/federation'

const STATUS_LABELS: Record<KarafielComplianceSummary['status'], string> = {
  ok: 'Compliant',
  failed: 'Failed checks',
  pending: 'Pending Karafiel check',
  unavailable: 'No grant applications',
}

const STATUS_VARIANTS: Record<
  KarafielComplianceSummary['status'],
  'success' | 'destructive' | 'secondary' | 'warning'
> = {
  ok: 'success',
  failed: 'destructive',
  pending: 'warning',
  unavailable: 'secondary',
}

function formatCheck(value: boolean | undefined): string {
  if (value === true) return 'Pass'
  if (value === false) return 'Fail'
  return '—'
}

interface KarafielCompliancePanelProps {
  summary: KarafielComplianceSummary
}

export function KarafielCompliancePanel({ summary }: KarafielCompliancePanelProps) {
  return (
    <section className="rounded-lg border bg-card p-6" aria-label="Karafiel compliance summary">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Karafiel compliance</h3>
          <p className="text-sm text-muted-foreground">
            Read-only Treasury Hunter checks from grant applications (Karafiel worker cache).
          </p>
        </div>
        <Badge variant={STATUS_VARIANTS[summary.status]}>{STATUS_LABELS[summary.status]}</Badge>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">RFC</dt>
          <dd className="font-medium">{summary.rfc ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">RFC active</dt>
          <dd className="font-medium">{formatCheck(summary.checks.rfc_active)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">32-D opinion</dt>
          <dd className="font-medium">{formatCheck(summary.checks.opinion_32d_positive)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Blacklist</dt>
          <dd className="font-medium">
            {summary.checks.blacklisted === true
              ? 'Listed'
              : summary.checks.blacklisted === false
                ? 'Clear'
                : '—'}
          </dd>
        </div>
      </dl>

      {summary.checks.checked_at ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Last checked {new Date(summary.checks.checked_at).toLocaleString()}
          {summary.grantApplicationId ? ` · application ${summary.grantApplicationId}` : ''}
        </p>
      ) : null}
    </section>
  )
}

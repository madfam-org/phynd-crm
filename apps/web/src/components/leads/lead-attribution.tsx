import type { LeadAttribution } from '@phynd/types/crm'

function formatMeetingStart(startsAt: string, timezone: string | undefined): string {
  const date = new Date(startsAt)
  if (Number.isNaN(date.getTime())) return startsAt
  if (timezone) {
    try {
      const text = date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      })
      return `${text} (${timezone})`
    } catch {
      // Not a zone name this runtime knows; show the time without one.
    }
  }
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Label and value for each attribution field a lead has, in display order. */
export function leadAttributionRows(
  attribution: LeadAttribution | null | undefined,
): [label: string, value: string][] {
  if (!attribution) return []
  const booking = attribution.booking
  const rows: [string, string | undefined][] = [
    ['UTM source', attribution.utm_source],
    ['UTM medium', attribution.utm_medium],
    ['UTM campaign', attribution.utm_campaign],
    ['UTM content', attribution.utm_content],
    ['UTM term', attribution.utm_term],
    ['Referrer', attribution.referrer],
    ['Landing page', attribution.landing_page],
    ['Meeting type', booking?.event_type_name],
    [
      'Meeting start',
      booking?.starts_at ? formatMeetingStart(booking.starts_at, booking.timezone) : undefined,
    ],
    ['Meeting host', booking?.host_name],
    ['Booking ID', booking?.id],
  ]
  return rows.filter((row): row is [string, string] => row[1] !== undefined)
}

/** Read-only card with where a lead came from; renders nothing without attribution. */
export function LeadAttributionCard({
  attribution,
}: {
  attribution: LeadAttribution | null | undefined
}) {
  const rows = leadAttributionRows(attribution)
  if (rows.length === 0) return null

  return (
    <div className="rounded-lg border bg-card p-6">
      <h3 className="mb-4 text-lg font-semibold">Attribution</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <span className="text-sm text-muted-foreground">{label}</span>
            <p className="break-words font-medium">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

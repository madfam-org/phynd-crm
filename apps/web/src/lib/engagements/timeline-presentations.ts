export type TimelineVisualTone = 'default' | 'milestone' | 'blocked' | 'failed' | 'completed'

// Event-type-scoped tones for events whose writer did not set a `status`
// (older rows, or producers that only send the event name). Status, when
// present, always wins — it is the writer's explicit UI intent.
const EVENT_TYPE_TONES: Record<string, TimelineVisualTone> = {
  'cotiza:quote_sent': 'milestone',
  'cotiza:quote_viewed': 'default',
  'cotiza:quote_approved': 'milestone',
  'cotiza:quote_rejected': 'failed',
  'cotiza:quote_expired': 'blocked',
  'cotiza:quote_ordered': 'completed',
}

// Friendly labels for well-known ecosystem event types. Anything not
// listed falls back to the generic `<source>:` prefix strip + underscore
// replacement in formatTimelineEventType.
const EVENT_TYPE_LABELS: Record<string, string> = {
  'cotiza:quote_sent': 'Quote sent to client',
  'cotiza:quote_viewed': 'Quote viewed by client',
  'cotiza:quote_approved': 'Quote approved by client',
  'cotiza:quote_rejected': 'Quote declined by client',
  'cotiza:quote_expired': 'Quote expired',
  'cotiza:quote_ordered': 'Order placed from quote',
  'system:quote_sent': 'Quote sent to client portal',
}

export function timelineEventTone(
  status: string | null | undefined,
  eventType?: string | null,
): TimelineVisualTone {
  if (status === 'milestone') return 'milestone'
  if (status === 'blocked') return 'blocked'
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'completed'
  if (!status && eventType) return EVENT_TYPE_TONES[eventType] ?? 'default'
  return 'default'
}

export function isBlockedRecoveryEvent(eventType: string) {
  return (
    eventType === 'system:production_dispatch_blocked' ||
    eventType === 'system:payment_unmatched' ||
    (eventType.startsWith('system:payment_') && eventType.endsWith('_unmatched'))
  )
}

export function formatTimelineEventType(eventType: string) {
  return eventType.replace(/^system:/, '').replace(/_/g, ' ')
}

export function timelineEventLabel(eventType: string) {
  return EVENT_TYPE_LABELS[eventType] ?? formatTimelineEventType(eventType)
}

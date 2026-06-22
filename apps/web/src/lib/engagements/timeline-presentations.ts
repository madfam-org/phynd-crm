export type TimelineVisualTone = 'default' | 'milestone' | 'blocked' | 'failed' | 'completed'

export function timelineEventTone(status: string | null | undefined): TimelineVisualTone {
  if (status === 'milestone') return 'milestone'
  if (status === 'blocked') return 'blocked'
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'completed'
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

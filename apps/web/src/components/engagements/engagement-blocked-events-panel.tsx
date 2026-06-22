'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isBlockedRecoveryEvent } from '@/lib/engagements/timeline-presentations'
import { trpc } from '@/lib/trpc/client'
import { AlertTriangle, CheckCircle2, Link2, RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

const DELIVERY_TRACKS = [
  'digital_experience',
  'digital_twin',
  'fabrication',
  'fulfillment',
  'kiosk',
] as const

interface EngagementBlockedEventsPanelProps {
  engagementId: string
}

export function EngagementBlockedEventsPanel({ engagementId }: EngagementBlockedEventsPanelProps) {
  const utils = trpc.useUtils()
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>

  const listBlocked = engagementsRouter.listBlockedEvents as NonNullable<
    typeof engagementsRouter.listBlockedEvents
  >
  const linkPayment = engagementsRouter.linkPaymentToOrder as NonNullable<
    typeof engagementsRouter.linkPaymentToOrder
  >
  const retryDispatch = engagementsRouter.retryProductionDispatch as NonNullable<
    typeof engagementsRouter.retryProductionDispatch
  >
  const resolveBlocked = engagementsRouter.resolveBlockedEvent as NonNullable<
    typeof engagementsRouter.resolveBlockedEvent
  >

  const { data: blockedEvents, isLoading } = listBlocked.useQuery({ engagementId })
  const { data: ordersData } = trpc.orders.list.useQuery({ limit: 50 })

  const [selectedOrderByEvent, setSelectedOrderByEvent] = useState<Record<string, string>>({})
  const [selectedTracksByEvent, setSelectedTracksByEvent] = useState<Record<string, string>>({})

  const linkMutation = linkPayment.useMutation({
    onSuccess: async () => {
      toast.success('Payment linked to order')
      await utils.engagements.listBlockedEvents.invalidate({ engagementId })
      await utils.engagements.getTimeline.invalidate({ engagementId })
    },
    onError: (err) => toast.error('Payment link failed', { description: err.message }),
  })

  const dispatchMutation = retryDispatch.useMutation({
    onSuccess: async (result) => {
      toast.success('Production dispatch requested', {
        description: `Tracks: ${result.dispatchedTracks.join(', ') || 'none'}`,
      })
      await utils.engagements.listBlockedEvents.invalidate({ engagementId })
      await utils.engagements.getTimeline.invalidate({ engagementId })
    },
    onError: (err) => toast.error('Dispatch retry failed', { description: err.message }),
  })

  const resolveMutation = resolveBlocked.useMutation({
    onSuccess: async () => {
      toast.success('Blocked event marked resolved')
      await utils.engagements.listBlockedEvents.invalidate({ engagementId })
      await utils.engagements.getTimeline.invalidate({ engagementId })
    },
    onError: (err) => toast.error('Could not resolve event', { description: err.message }),
  })

  const orderOptions = useMemo(
    () => ordersData?.items?.map((order) => ({ id: order.id, label: order.orderNumber })) ?? [],
    [ordersData],
  )

  if (isLoading) {
    return null
  }

  const events = (blockedEvents ?? []).filter((event) => isBlockedRecoveryEvent(event.eventType))
  if (events.length === 0) {
    return null
  }

  return (
    <section
      aria-label="Blocked lifecycle events"
      className="rounded-lg border border-amber-500/40 bg-amber-50/50 p-4 dark:border-amber-500/30 dark:bg-amber-950/20"
    >
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-100">
          Operator recovery ({events.length})
        </h2>
      </div>
      <ul className="space-y-3">
        {events.map((event) => {
          const isPayment = event.eventType.includes('payment')
          const isDispatch = event.eventType === 'system:production_dispatch_blocked'
          const selectedOrder = selectedOrderByEvent[event.id] ?? ''
          const selectedTrack = selectedTracksByEvent[event.id] ?? 'fabrication'

          return (
            <li
              key={event.id}
              className="rounded-md border border-amber-200/80 bg-white/80 p-3 dark:border-amber-900/50 dark:bg-slate-950/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning" className="text-[10px] uppercase">
                      blocked
                    </Badge>
                    <span className="text-sm font-medium">
                      {event.eventType.replace('system:', '')}
                    </span>
                  </div>
                  {event.message && (
                    <p className="mt-1 text-sm text-muted-foreground">{event.message}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={resolveMutation.isPending}
                  onClick={() => resolveMutation.mutate({ blockedEventId: event.id })}
                >
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Mark resolved
                </Button>
              </div>

              {isPayment && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <label
                      className="mb-1 block text-xs font-medium text-muted-foreground"
                      htmlFor={`order-${event.id}`}
                    >
                      Link to order
                    </label>
                    <Select
                      value={selectedOrder}
                      onValueChange={(value) =>
                        setSelectedOrderByEvent((prev) => ({ ...prev, [event.id]: value }))
                      }
                    >
                      <SelectTrigger id={`order-${event.id}`}>
                        <SelectValue placeholder="Select order" />
                      </SelectTrigger>
                      <SelectContent>
                        {orderOptions.map((order) => (
                          <SelectItem key={order.id} value={order.id}>
                            {order.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    disabled={!selectedOrder || linkMutation.isPending}
                    onClick={() =>
                      linkMutation.mutate({ blockedEventId: event.id, orderId: selectedOrder })
                    }
                  >
                    <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Link payment
                  </Button>
                </div>
              )}

              {isDispatch && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <label
                      className="mb-1 block text-xs font-medium text-muted-foreground"
                      htmlFor={`track-${event.id}`}
                    >
                      Delivery track
                    </label>
                    <Select
                      value={selectedTrack}
                      onValueChange={(value) =>
                        setSelectedTracksByEvent((prev) => ({ ...prev, [event.id]: value }))
                      }
                    >
                      <SelectTrigger id={`track-${event.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DELIVERY_TRACKS.map((track) => (
                          <SelectItem key={track} value={track}>
                            {track.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    disabled={dispatchMutation.isPending}
                    onClick={() =>
                      dispatchMutation.mutate({
                        blockedEventId: event.id,
                        deliveryTracks: [selectedTrack as (typeof DELIVERY_TRACKS)[number]],
                      })
                    }
                  >
                    <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Retry dispatch
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

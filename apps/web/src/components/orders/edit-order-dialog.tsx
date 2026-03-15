'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'
import { toast } from 'sonner'

interface EditOrderDialogProps {
  order: {
    id: string
    orderNumber: string
    totalAmount: string | null
    currency: string
    status: string
    estimatedCompletion: Date | null
    actualCompletion: Date | null
    ownerId: string | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ORDER_STATUSES = ['pending', 'confirmed', 'in_production', 'fulfilled', 'cancelled'] as const

export function EditOrderDialog({ order, open, onOpenChange }: EditOrderDialogProps) {
  const [orderNumber, setOrderNumber] = useState(order.orderNumber)
  const [totalAmount, setTotalAmount] = useState(order.totalAmount ?? '')
  const [currency, setCurrency] = useState(order.currency)
  const [status, setStatus] = useState(order.status)
  const [estimatedCompletion, setEstimatedCompletion] = useState(
    order.estimatedCompletion
      ? new Date(order.estimatedCompletion).toISOString().split('T')[0]
      : '',
  )
  const [actualCompletion, setActualCompletion] = useState(
    order.actualCompletion ? new Date(order.actualCompletion).toISOString().split('T')[0] : '',
  )
  const [ownerId, setOwnerId] = useState(order.ownerId ?? '')

  const { data: usersData } = trpc.users.list.useQuery(undefined, { retry: false })

  const utils = trpc.useUtils()
  const updateMutation = trpc.orders.update.useMutation({
    onSuccess: () => {
      utils.orders.list.invalidate()
      utils.orders.listMine.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to update order', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: order.id,
      orderNumber,
      totalAmount: totalAmount || undefined,
      currency: currency || undefined,
      status: status as (typeof ORDER_STATUSES)[number],
      estimatedCompletion: estimatedCompletion ? new Date(estimatedCompletion) : undefined,
      actualCompletion: actualCompletion ? new Date(actualCompletion) : undefined,
      ownerId: ownerId || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Order</DialogTitle>
            <DialogDescription>Update order details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-order-number">Order Number *</Label>
              <Input
                id="edit-order-number"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-order-amount">Amount ($)</Label>
                <Input
                  id="edit-order-amount"
                  type="number"
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-order-currency">Currency</Label>
                <Input
                  id="edit-order-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={10}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-order-est">Est. Completion</Label>
                <Input
                  id="edit-order-est"
                  type="date"
                  value={estimatedCompletion}
                  onChange={(e) => setEstimatedCompletion(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-order-actual">Actual Completion</Label>
                <Input
                  id="edit-order-actual"
                  type="date"
                  value={actualCompletion}
                  onChange={(e) => setActualCompletion(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {(usersData?.items ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name ?? u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !orderNumber}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

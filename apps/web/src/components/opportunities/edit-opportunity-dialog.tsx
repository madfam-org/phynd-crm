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

interface EditOpportunityDialogProps {
  opportunity: {
    id: string
    name: string
    value: string | null
    probability: number | null
    status: string
    ownerId: string | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditOpportunityDialog({
  opportunity,
  open,
  onOpenChange,
}: EditOpportunityDialogProps) {
  const [name, setName] = useState(opportunity.name)
  const [value, setValue] = useState(opportunity.value ?? '')
  const [probability, setProbability] = useState(String(opportunity.probability ?? ''))
  const [status, setStatus] = useState(opportunity.status)
  const [ownerId, setOwnerId] = useState(opportunity.ownerId ?? '')

  const { data: usersData } = trpc.users.list.useQuery(undefined, { retry: false })

  const utils = trpc.useUtils()
  const updateMutation = trpc.opportunities.update.useMutation({
    onSuccess: () => {
      utils.opportunities.list.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to update opportunity', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: opportunity.id,
      name,
      value: value || undefined,
      probability: probability ? Number(probability) : undefined,
      status: status as 'open' | 'won' | 'lost',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Opportunity</DialogTitle>
            <DialogDescription>Update opportunity details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-opp-name">Name *</Label>
              <Input
                id="edit-opp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-opp-value">Value ($)</Label>
                <Input
                  id="edit-opp-value"
                  type="number"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-opp-prob">Probability (%)</Label>
                <Input
                  id="edit-opp-prob"
                  type="number"
                  min={0}
                  max={100}
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
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
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
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
            <Button type="submit" disabled={updateMutation.isPending || !name}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

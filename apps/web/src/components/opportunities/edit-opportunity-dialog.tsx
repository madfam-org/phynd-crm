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
              <Label htmlFor="edit-opp-status">Status</Label>
              <select
                id="edit-opp-status"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
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

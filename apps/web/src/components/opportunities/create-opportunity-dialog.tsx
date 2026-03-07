'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'
import { toast } from 'sonner'

export function CreateOpportunityDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [probability, setProbability] = useState('')
  const [pipelineId, setPipelineId] = useState('')
  const [stageId, setStageId] = useState('')

  const { data: pipelines } = trpc.pipelines.list.useQuery()
  const { data: stages } = trpc.pipelines.getStages.useQuery(
    { pipelineId },
    { enabled: !!pipelineId },
  )

  const utils = trpc.useUtils()
  const createMutation = trpc.opportunities.create.useMutation({
    onSuccess: () => {
      utils.opportunities.list.invalidate()
      setOpen(false)
      resetForm()
    },
    onError: (err) => toast.error('Failed to create opportunity', { description: err.message }),
  })

  function resetForm() {
    setName('')
    setValue('')
    setProbability('')
    setPipelineId('')
    setStageId('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      name,
      value: value || undefined,
      probability: probability ? Number(probability) : undefined,
      pipelineId,
      stageId,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Opportunity</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Opportunity</DialogTitle>
            <DialogDescription>Add a new sales opportunity.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="opp-name">Name *</Label>
              <Input
                id="opp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="opp-value">Value ($)</Label>
                <Input
                  id="opp-value"
                  type="number"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="opp-prob">Probability (%)</Label>
                <Input
                  id="opp-prob"
                  type="number"
                  min={0}
                  max={100}
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="opp-pipeline">Pipeline *</Label>
              <select
                id="opp-pipeline"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={pipelineId}
                onChange={(e) => {
                  setPipelineId(e.target.value)
                  setStageId('')
                }}
                required
              >
                <option value="">Select pipeline</option>
                {pipelines?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {pipelineId && (
              <div className="grid gap-2">
                <Label htmlFor="opp-stage">Stage *</Label>
                <select
                  id="opp-stage"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  required
                >
                  <option value="">Select stage</option>
                  {stages?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !name || !pipelineId || !stageId}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

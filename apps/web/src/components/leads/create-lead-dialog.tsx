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

export function CreateLeadDialog() {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [pipelineId, setPipelineId] = useState('')
  const [stageId, setStageId] = useState('')

  const { data: pipelines } = trpc.pipelines.list.useQuery()
  const { data: stages } = trpc.pipelines.getStages.useQuery(
    { pipelineId },
    { enabled: !!pipelineId },
  )

  const utils = trpc.useUtils()
  const createMutation = trpc.leads.create.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate()
      setOpen(false)
      resetForm()
    },
    onError: (err) => toast.error('Failed to create lead', { description: err.message }),
  })

  function resetForm() {
    setSource('')
    setPipelineId('')
    setStageId('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      source: source || undefined,
      pipelineId,
      stageId,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Lead</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Lead</DialogTitle>
            <DialogDescription>Add a new lead to the pipeline.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="source">Source</Label>
              <Input
                id="source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. website, referral"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pipeline">Pipeline *</Label>
              <select
                id="pipeline"
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
                <Label htmlFor="stage">Stage *</Label>
                <select
                  id="stage"
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
            <Button type="submit" disabled={createMutation.isPending || !pipelineId || !stageId}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

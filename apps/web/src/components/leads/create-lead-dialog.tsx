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
              <Label>Pipeline *</Label>
              <Select
                value={pipelineId}
                onValueChange={(val: string) => {
                  setPipelineId(val)
                  setStageId('')
                }}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines?.items.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pipelineId && (
              <div className="grid gap-2">
                <Label>Stage *</Label>
                <Select value={stageId} onValueChange={setStageId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

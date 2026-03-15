'use client'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface EditPipelineDialogProps {
  pipeline: { id: string; name: string; isDefault: boolean } | null
  onClose: () => void
}

export function EditPipelineDialog({ pipeline, onClose }: EditPipelineDialogProps) {
  const [name, setName] = useState('')
  const [isDefault, setIsDefault] = useState(false)

  useEffect(() => {
    if (pipeline) {
      setName(pipeline.name)
      setIsDefault(pipeline.isDefault)
    }
  }, [pipeline])

  const utils = trpc.useUtils()
  const updateMutation = trpc.pipelines.update.useMutation({
    onSuccess: () => {
      utils.pipelines.list.invalidate()
      onClose()
    },
    onError: (err) => toast.error('Failed to update pipeline', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!pipeline) return
    updateMutation.mutate({
      id: pipeline.id,
      isDefault: isDefault || undefined,
      name,
    })
  }

  return (
    <Dialog open={!!pipeline} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Pipeline</DialogTitle>
            <DialogDescription>Update pipeline settings.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-pipeline-name">Name *</Label>
              <Input
                id="edit-pipeline-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-pipeline-default"
                checked={isDefault}
                onCheckedChange={(checked) => setIsDefault(checked === true)}
              />
              <Label htmlFor="edit-pipeline-default">Set as default pipeline</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
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

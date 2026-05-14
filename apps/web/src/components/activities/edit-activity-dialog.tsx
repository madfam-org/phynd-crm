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
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'
import { toast } from 'sonner'

interface EditActivityDialogProps {
  activity: {
    id: string
    title: string
    description: string | null
    dueAt: Date | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditActivityDialog({ activity, open, onOpenChange }: EditActivityDialogProps) {
  const [title, setTitle] = useState(activity.title)
  const [description, setDescription] = useState(activity.description ?? '')
  const [dueAt, setDueAt] = useState(
    activity.dueAt ? new Date(activity.dueAt).toISOString().slice(0, 16) : '',
  )

  const utils = trpc.useUtils()
  const activitiesRouter = trpc.activities as NonNullable<typeof trpc.activities>
  const updateActivity = activitiesRouter.update as NonNullable<typeof activitiesRouter.update>
  const activitiesUtils = utils.activities as NonNullable<typeof utils.activities>
  const listUtils = activitiesUtils.list as NonNullable<typeof activitiesUtils.list>
  const updateMutation = updateActivity.useMutation({
    onSuccess: () => {
      listUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to update activity', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: activity.id,
      title,
      description: description || null,
      dueAt: dueAt ? new Date(dueAt) : null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Activity</DialogTitle>
            <DialogDescription>Update activity details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-activity-title">Title *</Label>
              <Input
                id="edit-activity-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-activity-description">Description</Label>
              <Textarea
                id="edit-activity-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-activity-due">Due Date</Label>
              <Input
                id="edit-activity-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !title}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

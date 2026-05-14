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
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import { useState } from 'react'
import { toast } from 'sonner'

const ACTIVITY_TYPES = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'task', label: 'Task' },
  { value: 'note', label: 'Note' },
] as const

const ENTITY_TYPES = [
  { value: 'contact', label: 'Contact' },
  { value: 'lead', label: 'Lead' },
  { value: 'opportunity', label: 'Opportunity' },
] as const

export function CreateActivityDialog() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<string>('task')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [entityType, setEntityType] = useState<string>('contact')
  const [entityId, setEntityId] = useState('')

  const utils = trpc.useUtils()
  const activitiesRouter = trpc.activities as NonNullable<typeof trpc.activities>
  const createActivity = activitiesRouter.create as NonNullable<typeof activitiesRouter.create>
  const activitiesUtils = utils.activities as NonNullable<typeof utils.activities>
  const listUtils = activitiesUtils.list as NonNullable<typeof activitiesUtils.list>
  const createMutation = createActivity.useMutation({
    onSuccess: () => {
      listUtils.invalidate()
      setOpen(false)
      resetForm()
    },
    onError: (err) => toast.error('Failed to create activity', { description: err.message }),
  })

  function resetForm() {
    setType('task')
    setTitle('')
    setDescription('')
    setDueAt('')
    setEntityType('contact')
    setEntityId('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      type: type as 'call' | 'email' | 'meeting' | 'task' | 'note',
      title,
      description: description || undefined,
      dueAt: dueAt ? new Date(dueAt) : undefined,
      entityType: entityType as 'contact' | 'lead' | 'opportunity',
      entityId,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Activity</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Activity</DialogTitle>
            <DialogDescription>Add a new activity to track.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="activity-type">Type *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="activity-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="activity-title">Title *</Label>
              <Input
                id="activity-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="activity-description">Description</Label>
              <Textarea
                id="activity-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="activity-due">Due Date</Label>
              <Input
                id="activity-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="activity-entity-type">Entity Type *</Label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger id="activity-entity-type">
                  <SelectValue placeholder="Select entity type" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((et) => (
                    <SelectItem key={et.value} value={et.value}>
                      {et.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="activity-entity-id">Entity ID *</Label>
              <Input
                id="activity-entity-id"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="UUID of the related entity"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !title || !entityId}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

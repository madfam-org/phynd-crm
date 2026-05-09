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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import type { EntityType } from '@phynd/types/crm'
import { useState } from 'react'
import { toast } from 'sonner'

interface CreateNoteDialogProps {
  entityType: EntityType
  entityId: string
}

export function CreateNoteDialog({ entityType, entityId }: CreateNoteDialogProps) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [isPinned, setIsPinned] = useState(false)

  const utils = trpc.useUtils()
  const createMutation = trpc.notes.create.useMutation({
    onSuccess: () => {
      utils.notes.listForEntity.invalidate({ entityType, entityId })
      setOpen(false)
      resetForm()
    },
    onError: (err) => toast.error('Failed to create note', { description: err.message }),
  })

  function resetForm() {
    setContent('')
    setIsPinned(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      content,
      entityType,
      entityId,
      isPinned: isPinned || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Add Note</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
            <DialogDescription>Create a new note for this {entityType}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="note-content">Content *</Label>
              <Textarea
                id="note-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="Write your note..."
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="note-pinned"
                type="checkbox"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="note-pinned">Pin this note</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !content.trim()}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

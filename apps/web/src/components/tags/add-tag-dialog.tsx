'use client'

import { Badge } from '@/components/ui/badge'
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
import type { EntityType } from '@phynd/types/crm'
import { useState } from 'react'
import { toast } from 'sonner'

interface AddTagDialogProps {
  entityType: EntityType
  entityId: string
}

export function AddTagDialog({ entityType, entityId }: AddTagDialogProps) {
  const [open, setOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('')

  const utils = trpc.useUtils()

  const { data: allTags } = trpc.tags.list.useQuery(undefined, {
    enabled: open,
  })

  const { data: entityTags } = trpc.tags.getForEntity.useQuery(
    { entityType, entityId },
    { enabled: open },
  )

  const addToEntityMutation = trpc.tags.addToEntity.useMutation({
    onSuccess: () => {
      utils.tags.getForEntity.invalidate({ entityType, entityId })
    },
    onError: (err) => toast.error('Failed to add tag', { description: err.message }),
  })

  const createMutation = trpc.tags.create.useMutation({
    onSuccess: (newTag) => {
      utils.tags.list.invalidate()
      addToEntityMutation.mutate({ tagId: newTag.id, entityType, entityId })
      setNewTagName('')
      setNewTagColor('')
    },
    onError: (err) => toast.error('Failed to create tag', { description: err.message }),
  })

  const entityTagIds = new Set((entityTags ?? []).map((t) => t.id))

  const availableTags = (allTags?.items ?? []).filter((tag) => !entityTagIds.has(tag.id))

  function handleCreateTag(e: React.FormEvent) {
    e.preventDefault()
    if (!newTagName.trim()) return
    createMutation.mutate({
      name: newTagName.trim(),
      color: newTagColor || undefined,
    })
  }

  function handleSelectTag(tagId: string) {
    addToEntityMutation.mutate({ tagId, entityType, entityId })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Add Tag
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Tag</DialogTitle>
          <DialogDescription>Select an existing tag or create a new one.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {availableTags.length > 0 && (
            <div className="space-y-2">
              <Label>Existing Tags</Label>
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleSelectTag(tag.id)}
                    disabled={addToEntityMutation.isPending}
                    className="cursor-pointer"
                  >
                    <Badge
                      variant="outline"
                      className="transition-colors hover:bg-secondary"
                      style={tag.color ? { borderColor: tag.color } : undefined}
                    >
                      {tag.name}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleCreateTag} className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="new-tag-name">New Tag Name</Label>
              <Input
                id="new-tag-name"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="e.g. VIP, Follow-up"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-tag-color">Color (optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="new-tag-color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  placeholder="#3b82f6"
                  maxLength={7}
                  className="flex-1"
                />
                {newTagColor && (
                  <div
                    className="h-8 w-8 shrink-0 rounded-md border"
                    style={{ backgroundColor: newTagColor }}
                    aria-label={`Color preview: ${newTagColor}`}
                  />
                )}
              </div>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={createMutation.isPending || !newTagName.trim()}
            >
              {createMutation.isPending ? 'Creating...' : 'Create & Add'}
            </Button>
          </form>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

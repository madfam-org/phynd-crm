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

interface TagOption {
  id: string
  name: string
  color: string | null
}

interface TagsListOutput {
  items: TagOption[]
}

function getCreatedTagId(value: unknown): string | null {
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}

export function AddTagDialog({ entityType, entityId }: AddTagDialogProps) {
  const [open, setOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('')

  const utils = trpc.useUtils()
  const tagsRouter = trpc.tags as NonNullable<typeof trpc.tags>
  const listTags = tagsRouter.list as NonNullable<typeof tagsRouter.list>
  const getTagsForEntity = tagsRouter.getForEntity as NonNullable<typeof tagsRouter.getForEntity>
  const addTagToEntity = tagsRouter.addToEntity as NonNullable<typeof tagsRouter.addToEntity>
  const createTag = tagsRouter.create as NonNullable<typeof tagsRouter.create>
  const tagsUtils = utils.tags as NonNullable<typeof utils.tags>
  const listTagsUtils = tagsUtils.list as NonNullable<typeof tagsUtils.list>
  const getTagsForEntityUtils = tagsUtils.getForEntity as NonNullable<typeof tagsUtils.getForEntity>

  const { data: allTagsData } = listTags.useQuery(undefined, {
    enabled: open,
  })

  const { data: entityTagsData } = getTagsForEntity.useQuery(
    { entityType, entityId },
    { enabled: open },
  )
  const allTags = (allTagsData as TagsListOutput | undefined)?.items ?? []
  const entityTags = (entityTagsData as TagOption[] | undefined) ?? []

  const addToEntityMutation = addTagToEntity.useMutation({
    onSuccess: () => {
      getTagsForEntityUtils.invalidate({ entityType, entityId })
    },
    onError: (err) => toast.error('Failed to add tag', { description: err.message }),
  })

  const createMutation = createTag.useMutation({
    onSuccess: (newTag: unknown) => {
      const tagId = getCreatedTagId(newTag)
      if (!tagId) {
        toast.error('Failed to create tag', { description: 'Created tag response is missing id' })
        return
      }
      listTagsUtils.invalidate()
      addToEntityMutation.mutate({ tagId, entityType, entityId })
      setNewTagName('')
      setNewTagColor('')
    },
    onError: (err) => toast.error('Failed to create tag', { description: err.message }),
  })

  const entityTagIds = new Set(entityTags.map((tag) => tag.id))

  const availableTags = allTags.filter((tag) => !entityTagIds.has(tag.id))

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

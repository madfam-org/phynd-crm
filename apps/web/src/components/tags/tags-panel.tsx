'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc/client'
import type { EntityType } from '@phynd/types/crm'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { AddTagDialog } from './add-tag-dialog'

interface TagsPanelProps {
  entityType: EntityType
  entityId: string
}

interface EntityTag {
  id: string
  name: string
  color: string | null
}

export function TagsPanel({ entityType, entityId }: TagsPanelProps) {
  const tagsRouter = trpc.tags as NonNullable<typeof trpc.tags>
  const getTagsForEntity = tagsRouter.getForEntity as NonNullable<typeof tagsRouter.getForEntity>
  const removeTagFromEntity = tagsRouter.removeFromEntity as NonNullable<
    typeof tagsRouter.removeFromEntity
  >
  const { data: entityTagsData, isLoading } = getTagsForEntity.useQuery({ entityType, entityId })
  const entityTags = (entityTagsData as EntityTag[] | undefined) ?? []

  const utils = trpc.useUtils()
  const tagsUtils = utils.tags as NonNullable<typeof utils.tags>
  const getTagsForEntityUtils = tagsUtils.getForEntity as NonNullable<typeof tagsUtils.getForEntity>

  const removeMutation = removeTagFromEntity.useMutation({
    onSuccess: () => {
      getTagsForEntityUtils.invalidate({ entityType, entityId })
    },
    onError: (err) => toast.error('Failed to remove tag', { description: err.message }),
  })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading tags...</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Tags</h3>
        <AddTagDialog entityType={entityType} entityId={entityId} />
      </div>

      {entityTags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tags yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2" aria-label="Tags">
          {entityTags.map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              className="gap-1"
              style={tag.color ? { backgroundColor: tag.color, color: '#fff' } : undefined}
            >
              {tag.name}
              <button
                type="button"
                onClick={() => removeMutation.mutate({ tagId: tag.id, entityType, entityId })}
                disabled={removeMutation.isPending}
                className="ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label={`Remove ${tag.name} tag`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

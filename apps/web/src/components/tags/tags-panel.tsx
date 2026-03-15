'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc/client'
import type { EntityType } from '@phyne/types/crm'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { AddTagDialog } from './add-tag-dialog'

interface TagsPanelProps {
  entityType: EntityType
  entityId: string
}

export function TagsPanel({ entityType, entityId }: TagsPanelProps) {
  const { data: entityTags, isLoading } = trpc.tags.getForEntity.useQuery({ entityType, entityId })

  const utils = trpc.useUtils()

  const removeMutation = trpc.tags.removeFromEntity.useMutation({
    onSuccess: () => {
      utils.tags.getForEntity.invalidate({ entityType, entityId })
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

      {!entityTags || entityTags.length === 0 ? (
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

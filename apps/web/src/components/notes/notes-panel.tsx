'use client'

import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc/client'
import { Pin, PinOff, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { CreateNoteDialog } from './create-note-dialog'

interface NotesPanelProps {
  entityType: 'contact' | 'lead' | 'opportunity'
  entityId: string
}

function formatDate(date: Date | string | null): string {
  if (!date) return ''
  return new Date(date).toLocaleString()
}

export function NotesPanel({ entityType, entityId }: NotesPanelProps) {
  const { data: notes, isLoading } = trpc.notes.listForEntity.useQuery({ entityType, entityId })

  const utils = trpc.useUtils()

  const deleteMutation = trpc.notes.delete.useMutation({
    onSuccess: () => {
      utils.notes.listForEntity.invalidate({ entityType, entityId })
    },
    onError: (err) => toast.error('Failed to delete note', { description: err.message }),
  })

  const togglePinMutation = trpc.notes.togglePin.useMutation({
    onSuccess: () => {
      utils.notes.listForEntity.invalidate({ entityType, entityId })
    },
    onError: (err) => toast.error('Failed to toggle pin', { description: err.message }),
  })

  const sortedNotes = [...(notes ?? [])].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading notes...</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Notes</h3>
        <CreateNoteDialog entityType={entityType} entityId={entityId} />
      </div>

      {sortedNotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Notes list">
          {sortedNotes.map((note) => (
            <li key={note.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {note.isPinned && (
                    <span className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Pin className="h-3 w-3" aria-hidden="true" />
                      Pinned
                    </span>
                  )}
                  <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>By {note.authorId}</span>
                    <span aria-hidden="true">&middot;</span>
                    <time dateTime={new Date(note.createdAt).toISOString()}>
                      {formatDate(note.createdAt)}
                    </time>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => togglePinMutation.mutate({ id: note.id })}
                    disabled={togglePinMutation.isPending}
                    aria-label={note.isPinned ? 'Unpin note' : 'Pin note'}
                  >
                    {note.isPinned ? (
                      <PinOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Pin className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate({ id: note.id })}
                    disabled={deleteMutation.isPending}
                    aria-label="Delete note"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

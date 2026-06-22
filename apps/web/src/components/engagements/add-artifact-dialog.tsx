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

const ARTIFACT_TYPES = [
  'quote',
  'signed_proposal',
  'service_agreement',
  'statement_of_work',
  'msa',
  'invoice',
  'deliverable',
  'nft_receipt',
] as const

type ArtifactType = (typeof ARTIFACT_TYPES)[number]

interface AddArtifactDialogProps {
  engagementId: string
}

export function AddArtifactDialog({ engagementId }: AddArtifactDialogProps) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ArtifactType>('deliverable')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  const utils = trpc.useUtils()
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const addArtifact = engagementsRouter.addArtifact as NonNullable<
    typeof engagementsRouter.addArtifact
  >
  const engagementsUtils = utils.engagements as NonNullable<typeof utils.engagements>
  const listArtifactsUtils = engagementsUtils.listArtifacts as NonNullable<
    typeof engagementsUtils.listArtifacts
  >
  const addMutation = addArtifact.useMutation({
    onSuccess: () => {
      listArtifactsUtils.invalidate({ engagementId })
      toast.success('Artifact added')
      setOpen(false)
      resetForm()
    },
    onError: (err) => toast.error('Failed to add artifact', { description: err.message }),
  })

  function resetForm() {
    setType('deliverable')
    setTitle('')
    setUrl('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    addMutation.mutate({
      engagementId,
      type,
      title: title.trim() || undefined,
      url: url.trim() || undefined,
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Add Artifact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Artifact</DialogTitle>
            <DialogDescription>
              Surface a deliverable, invoice, or signed document to the client portal.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Type *</Label>
              <Select value={type} onValueChange={(v) => setType(v as ArtifactType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ARTIFACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="artifact-title">Title</Label>
              <Input
                id="artifact-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Phase 1 delivery — final drop"
                maxLength={255}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="artifact-url">URL</Label>
              <Input
                id="artifact-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://drive.madfam.io/..."
              />
              <p className="text-xs text-muted-foreground">
                Optional. Must be a valid URL if provided.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={addMutation.isPending || !type}>
              {addMutation.isPending ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

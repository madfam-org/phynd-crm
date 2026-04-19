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

const ENGAGEMENT_STATUSES = ['active', 'completed', 'paused', 'cancelled'] as const

interface CreateEngagementDialogProps {
  // When provided, the contact select is hidden and the engagement is
  // auto-scoped to this contact — used from the client-detail page.
  contactId?: string
  // Custom trigger element (defaults to a primary "Create" button).
  trigger?: React.ReactNode
  onCreated?: (engagementId: string) => void
}

export function CreateEngagementDialog({
  contactId: lockedContactId,
  trigger,
  onCreated,
}: CreateEngagementDialogProps) {
  const [open, setOpen] = useState(false)
  const [contactId, setContactId] = useState(lockedContactId ?? '')
  const [projectName, setProjectName] = useState('')
  const [description, setDescription] = useState('')
  const [opportunityId, setOpportunityId] = useState('')
  const [status, setStatus] = useState<(typeof ENGAGEMENT_STATUSES)[number]>('active')

  const { data: contactsData } = trpc.contacts.list.useQuery(undefined, {
    enabled: open && !lockedContactId,
  })
  const { data: opportunitiesData } = trpc.opportunities.listByContactId.useQuery(
    { contactId: contactId },
    { enabled: open && !!contactId },
  )

  const utils = trpc.useUtils()
  const createMutation = trpc.engagements.create.useMutation({
    onSuccess: (row) => {
      utils.engagements.list.invalidate()
      if (lockedContactId) {
        utils.engagements.listByContactId.invalidate({ contactId: lockedContactId })
      }
      toast.success('Engagement created')
      setOpen(false)
      resetForm()
      if (row?.id) {
        onCreated?.(row.id)
      }
    },
    onError: (err) => toast.error('Failed to create engagement', { description: err.message }),
  })

  function resetForm() {
    setContactId(lockedContactId ?? '')
    setProjectName('')
    setDescription('')
    setOpportunityId('')
    setStatus('active')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contactId || !projectName.trim()) return
    createMutation.mutate({
      contactId,
      projectName: projectName.trim(),
      description: description.trim() || undefined,
      opportunityId: opportunityId || undefined,
      status,
    })
  }

  const canSubmit = Boolean(contactId && projectName.trim())

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger asChild>{trigger ?? <Button>Create Engagement</Button>}</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Engagement</DialogTitle>
            <DialogDescription>
              Start a new client-engagement project. Links Pravara fab work, Selva digital work, and
              Cotiza proposals under a single client-facing timeline.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {!lockedContactId && (
              <div className="grid gap-2">
                <Label htmlFor="engagement-contact">Contact *</Label>
                <Select value={contactId} onValueChange={setContactId}>
                  <SelectTrigger id="engagement-contact">
                    <SelectValue placeholder="Select contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {(contactsData?.items ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.email ? ` · ${c.email}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="engagement-project-name">Project Name *</Label>
              <Input
                id="engagement-project-name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Tablaco — Phase 1 fabrication + delivery"
                maxLength={255}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="engagement-description">Description</Label>
              <Textarea
                id="engagement-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional context — scope, dates, internal notes"
                maxLength={2000}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label>Opportunity</Label>
              <Select value={opportunityId} onValueChange={setOpportunityId} disabled={!contactId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      contactId ? 'Optional — link opportunity' : 'Select a contact first'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {(opportunitiesData?.items ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as (typeof ENGAGEMENT_STATUSES)[number])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {ENGAGEMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !canSubmit}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'

const ENGAGEMENT_STATUSES = ['active', 'completed', 'paused', 'cancelled'] as const
type RouterOutputs = inferRouterOutputs<AppRouter>
type ContactsListOutput = RouterOutputs['contacts']['list']
type OpportunitiesByContactOutput = RouterOutputs['opportunities']['listByContactId']
type ContactOption = ContactsListOutput['items'][number]
type OpportunityOption = OpportunitiesByContactOutput['items'][number]

function getCreatedEngagementId(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined
  const candidate = row as { id?: unknown }
  return typeof candidate.id === 'string' ? candidate.id : undefined
}

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

  const contactsRouter = trpc.contacts as NonNullable<typeof trpc.contacts>
  const opportunitiesRouter = trpc.opportunities as NonNullable<typeof trpc.opportunities>
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const listContacts = contactsRouter.list as NonNullable<typeof contactsRouter.list>
  const listOpportunitiesByContactId = opportunitiesRouter.listByContactId as NonNullable<
    typeof opportunitiesRouter.listByContactId
  >
  const createEngagement = engagementsRouter.create as NonNullable<typeof engagementsRouter.create>

  const { data: contactsData } = listContacts.useQuery(undefined, {
    enabled: open && !lockedContactId,
  })
  const { data: opportunitiesData } = listOpportunitiesByContactId.useQuery(
    { contactId: contactId },
    { enabled: open && !!contactId },
  )
  const contactOptions = (contactsData as ContactsListOutput | undefined)?.items ?? []
  const opportunityOptions =
    (opportunitiesData as OpportunitiesByContactOutput | undefined)?.items ?? []

  const utils = trpc.useUtils()
  const engagementsUtils = utils.engagements as NonNullable<typeof utils.engagements>
  const listEngagementsUtils = engagementsUtils.list as NonNullable<typeof engagementsUtils.list>
  const listByContactUtils = engagementsUtils.listByContactId as NonNullable<
    typeof engagementsUtils.listByContactId
  >
  const createMutation = createEngagement.useMutation({
    onSuccess: (row) => {
      listEngagementsUtils.invalidate()
      if (lockedContactId) {
        listByContactUtils.invalidate({ contactId: lockedContactId })
      }
      toast.success('Engagement created')
      setOpen(false)
      resetForm()
      const createdId = getCreatedEngagementId(row)
      if (createdId) {
        onCreated?.(createdId)
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
                    {contactOptions.map((c: ContactOption) => (
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
                  {opportunityOptions.map((o: OpportunityOption) => (
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

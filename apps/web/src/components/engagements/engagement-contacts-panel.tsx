'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

// Extra contacts of an engagement. The primary contact can always open the
// portal; these need "Portal access" on, and get the magic link at their own
// email (the session email must match a portal-enabled contact).

type Row = inferRouterOutputs<AppRouter>['engagementContacts']['list'][number]

export function EngagementContactsPanel({
  engagementId,
  primaryContactId,
}: {
  engagementId: string
  primaryContactId: string
}) {
  const utils = trpc.useUtils()
  const ecRouter = trpc.engagementContacts as NonNullable<typeof trpc.engagementContacts>
  const ecUtils = utils.engagementContacts as NonNullable<typeof utils.engagementContacts>
  const refresh = () => ecUtils.list.invalidate({ engagementId })
  const onError = (err: { message: string }) => {
    toast.error('Contact change failed', { description: err.message })
  }

  const list = ecRouter.list.useQuery({ engagementId })
  const upsert = ecRouter.upsert.useMutation({ onSuccess: refresh, onError })
  const remove = ecRouter.remove.useMutation({ onSuccess: refresh, onError })
  const engagementsRouter = trpc.engagements as NonNullable<typeof trpc.engagements>
  const sendLink = engagementsRouter.sendPortalLink.useMutation({
    onSuccess: (r) => {
      toast.success('Portal link sent', { description: r.emailRedacted })
    },
    onError,
  })
  const contactsQuery = trpc.contacts.list.useQuery({ limit: 200 })

  const [contactId, setContactId] = useState('')
  const [role, setRole] = useState('')
  const rows = (list.data ?? []) as Row[]
  const taken = new Set([primaryContactId, ...rows.map((r) => r.contactId)])
  const candidates = (contactsQuery.data?.items ?? []).filter((c) => !taken.has(c.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Select value={contactId} onValueChange={setContactId}>
            <SelectTrigger aria-label="Contact to add">
              <SelectValue placeholder="Add a contact…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` · ${c.email}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          aria-label="Role"
          className="sm:w-40"
          placeholder="Role (optional)"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!contactId || upsert.isPending}
          onClick={() => {
            upsert.mutate({ engagementId, contactId, role: role.trim() || null })
            setContactId('')
            setRole('')
          }}
        >
          Add
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Only the primary contact so far.</p>
      ) : (
        <ul className="space-y-2" aria-label="Engagement contacts">
          {rows.map((r) => (
            <li className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row" key={r.id}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {r.name}
                  {r.role && <span className="text-muted-foreground"> · {r.role}</span>}
                </p>
                <p className="text-xs text-muted-foreground">{r.email ?? 'no email'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Badge variant={r.portalAccess ? 'success' : 'outline'} className="text-[10px]">
                  {r.portalAccess ? 'portal access' : 'no portal access'}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={!r.email}
                  onClick={() =>
                    upsert.mutate({
                      engagementId,
                      contactId: r.contactId,
                      role: r.role,
                      portalAccess: !r.portalAccess,
                    })
                  }
                >
                  {r.portalAccess ? 'Revoke portal' : 'Allow portal'}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Send portal link"
                  disabled={!r.portalAccess || sendLink.isPending}
                  onClick={() => sendLink.mutate({ engagementId, contactId: r.contactId })}
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove contact"
                  onClick={() => remove.mutate({ engagementId, contactId: r.contactId })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

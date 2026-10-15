'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { ArrowDown, ArrowUp, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

// Staff panel for an engagement's milestones, deliverables, actionables and
// decisions. Items are internal until "Show to client" is on; the client
// portal renders client-visible items only.

const KINDS = ['milestone', 'deliverable', 'actionable', 'decision'] as const
const STATUSES = ['planned', 'in_progress', 'done', 'blocked', 'awaiting_client'] as const
const SIDES = ['madfam', 'client'] as const
type Kind = (typeof KINDS)[number]
type Status = (typeof STATUSES)[number]
type Side = (typeof SIDES)[number]

type Item = inferRouterOutputs<AppRouter>['engagementItems']['list'][number]

const label = (s: string) => s.replace(/_/g, ' ')

function useItemsApi(engagementId: string) {
  const utils = trpc.useUtils()
  const itemsRouter = trpc.engagementItems as NonNullable<typeof trpc.engagementItems>
  const itemsUtils = utils.engagementItems as NonNullable<typeof utils.engagementItems>
  const refresh = () => itemsUtils.list.invalidate({ engagementId })
  const onError = (err: { message: string }) => {
    toast.error('Item change failed', { description: err.message })
  }
  return {
    list: itemsRouter.list.useQuery({ engagementId }),
    create: itemsRouter.create.useMutation({ onSuccess: refresh, onError }),
    update: itemsRouter.update.useMutation({ onSuccess: refresh, onError }),
    reorder: itemsRouter.reorder.useMutation({ onSuccess: refresh, onError }),
    remove: itemsRouter.delete.useMutation({ onSuccess: refresh, onError }),
  }
}

function NewItemForm({ onCreate, pending }: { onCreate: (v: NewItem) => void; pending: boolean }) {
  const [kind, setKind] = useState<Kind>('actionable')
  const [side, setSide] = useState<Side>('madfam')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    onCreate({
      kind,
      side,
      title: title.trim(),
      description: description.trim() || null,
      dueAt: dueAt ? new Date(`${dueAt}T12:00:00Z`) : null,
    })
    setTitle('')
    setDescription('')
    setDueAt('')
  }

  return (
    <form className="grid gap-3 rounded-md border p-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {label(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Side</Label>
          <Select value={side} onValueChange={(v) => setSide(v as Side)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="madfam">MADFAM</SelectItem>
              <SelectItem value="client">Client</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="item-due">Due</Label>
          <Input
            id="item-due"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="item-title">Title *</Label>
        <Input id="item-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="item-description">Description (the client sees it when shown)</Label>
        <Textarea
          id="item-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>
          Add item (internal)
        </Button>
      </div>
    </form>
  )
}

interface NewItem {
  kind: Kind
  side: Side
  title: string
  description: string | null
  dueAt: Date | null
}

function ItemRow({
  item,
  index,
  total,
  api,
  move,
}: {
  item: Item
  index: number
  total: number
  api: ReturnType<typeof useItemsApi>
  move: (from: number, to: number) => void
}) {
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[10px] uppercase">
            {label(item.kind)}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {item.side === 'client' ? 'client' : 'MADFAM'}
          </Badge>
          <Badge variant={item.clientVisible ? 'success' : 'outline'} className="text-[10px]">
            {item.clientVisible ? 'client-visible' : 'internal'}
          </Badge>
          <span className="text-sm font-medium">{item.title}</span>
        </div>
        {item.dueAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            Due {new Date(item.dueAt).toLocaleDateString()}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Select
          value={item.status}
          onValueChange={(v) => api.update.mutate({ id: item.id, status: v as Status })}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {label(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => api.update.mutate({ id: item.id, clientVisible: !item.clientVisible })}
        >
          {item.clientVisible ? (
            <EyeOff className="mr-1 h-3 w-3" aria-hidden="true" />
          ) : (
            <Eye className="mr-1 h-3 w-3" aria-hidden="true" />
          )}
          {item.clientVisible ? 'Hide from client' : 'Show to client'}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Move up"
          disabled={index === 0}
          onClick={() => move(index, index - 1)}
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Move down"
          disabled={index === total - 1}
          onClick={() => move(index, index + 1)}
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete item"
          onClick={() => {
            if (window.confirm(`Delete "${item.title}"?`)) api.remove.mutate({ id: item.id })
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}

export function EngagementItemsPanel({ engagementId }: { engagementId: string }) {
  const api = useItemsApi(engagementId)
  const items = (api.list.data ?? []) as Item[]

  function move(from: number, to: number) {
    const ids = items.map((i) => i.id)
    const [moved] = ids.splice(from, 1)
    if (!moved) return
    ids.splice(to, 0, moved)
    api.reorder.mutate({ engagementId, orderedIds: ids })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        New items are internal. Only items shown to the client appear in the client portal.
      </p>
      <NewItemForm
        pending={api.create.isPending}
        onCreate={(v) => api.create.mutate({ engagementId, ...v })}
      />
      {api.list.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading items...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Engagement items">
          {items.map((item, index) => (
            <ItemRow
              api={api}
              index={index}
              item={item}
              key={item.id}
              move={move}
              total={items.length}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

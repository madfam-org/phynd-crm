'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phyne/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'

type OffersListOutput = inferRouterOutputs<AppRouter>['offers']['list']
type OfferRow = OffersListOutput['items'][number]

interface OffersDataTableProps {
  initialData: OffersListOutput
}

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  draft: 'secondary',
  active: 'success',
  paused: 'warning',
  expired: 'default',
}

export function OffersDataTable({ initialData }: OffersDataTableProps) {
  const { data: offers } = trpc.offers.list.useQuery(undefined, { initialData })
  const [createOpen, setCreateOpen] = useState(false)

  const utils = trpc.useUtils()
  const deleteMutation = trpc.offers.delete.useMutation({
    onSuccess: () => utils.offers.list.invalidate(),
    onError: (err) => toast.error('Failed to delete offer', { description: err.message }),
  })

  const createMutation = trpc.offers.create.useMutation({
    onSuccess: () => {
      utils.offers.list.invalidate()
      setCreateOpen(false)
    },
    onError: (err) => toast.error('Failed to create offer', { description: err.message }),
  })

  const columns: ColumnDef<OfferRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'type',
      header: 'Type',
      cell: (row) => <Badge variant="outline">{row.type}</Badge>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <Badge variant={statusVariant[row.status] ?? 'default'}>{row.status}</Badge>,
    },
    {
      id: 'redemptions',
      header: 'Redemptions',
      cell: (row) =>
        row.maxRedemptions
          ? `${row.currentRedemptions}/${row.maxRedemptions}`
          : String(row.currentRedemptions),
    },
    {
      id: 'value',
      header: 'Value',
      cell: (row) => (row.value ? `${row.currency ?? ''} ${row.value}`.trim() : '—'),
    },
    {
      id: 'actions',
      header: '',
      className: 'w-[50px]',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              ...
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => deleteMutation.mutate({ id: row.id })}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>Create Offer</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Offer</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                createMutation.mutate({
                  name: fd.get('name') as string,
                  type:
                    (fd.get('type') as 'discount' | 'bundle' | 'free_trial' | 'custom') ||
                    undefined,
                  description: (fd.get('description') as string) || undefined,
                })
              }}
            >
              <input
                name="name"
                placeholder="Offer name"
                required
                className="w-full rounded border px-3 py-2"
              />
              <select name="type" className="w-full rounded border px-3 py-2">
                <option value="custom">Custom</option>
                <option value="discount">Discount</option>
                <option value="bundle">Bundle</option>
                <option value="free_trial">Free Trial</option>
              </select>
              <textarea
                name="description"
                placeholder="Description (optional)"
                className="w-full rounded border px-3 py-2"
                rows={3}
              />
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <DataTable columns={columns} data={offers?.items ?? []} getRowKey={(row) => row.id} />
    </div>
  )
}

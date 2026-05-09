'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { exportToCsv } from '@/lib/csv-export'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CreateQuoteDialog } from './create-quote-dialog'
import { EditQuoteDialog } from './edit-quote-dialog'

type QuotesListOutput = inferRouterOutputs<AppRouter>['quotes']['list']
type QuoteRow = QuotesListOutput['items'][number]

interface QuotesDataTableProps {
  initialData: QuotesListOutput
}

const statusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  accepted: 'success',
  declined: 'destructive',
  draft: 'secondary',
  expired: 'warning',
  sent: 'default',
}

type ViewMode = 'all' | 'mine'

export function QuotesDataTable({ initialData }: QuotesDataTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [deleteQuote, setDeleteQuote] = useState<QuoteRow | null>(null)

  const { data: allQuotes } = trpc.quotes.list.useQuery(undefined, {
    initialData,
    refetchInterval: 60_000,
    enabled: viewMode === 'all',
  })
  const { data: myQuotes } = trpc.quotes.listMine.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: viewMode === 'mine',
  })

  const quotes = viewMode === 'mine' ? myQuotes : allQuotes
  const { data: usersData } = trpc.users.list.useQuery(undefined, { retry: false })
  const [editQuote, setEditQuote] = useState<QuoteRow | null>(null)

  const userMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of usersData?.items ?? []) {
      map.set(u.id, u.name ?? u.email)
    }
    return map
  }, [usersData])

  const utils = trpc.useUtils()
  const invalidateQuotes = () => {
    utils.quotes.list.invalidate()
    utils.quotes.listMine.invalidate()
  }
  const deleteMutation = trpc.quotes.delete.useMutation({
    onSuccess: () => {
      invalidateQuotes()
      setDeleteQuote(null)
    },
    onError: (err) => toast.error('Failed to delete quote', { description: err.message }),
  })
  const acceptMutation = trpc.quotes.accept.useMutation({
    onSuccess: () => {
      invalidateQuotes()
      utils.orders.list.invalidate()
      utils.orders.listMine.invalidate()
      utils.opportunities.list.invalidate()
      utils.opportunities.listMine.invalidate()
      toast.success('Quote accepted')
    },
    onError: (err) => toast.error('Failed to accept quote', { description: err.message }),
  })

  const columns: ColumnDef<QuoteRow>[] = [
    {
      id: 'quoteNumber',
      header: 'Quote #',
      cell: (row) => (
        <Link href={`/quotes/${row.id}`} className="font-medium text-primary hover:underline">
          {row.quoteNumber}
        </Link>
      ),
    },
    {
      id: 'totalAmount',
      header: 'Amount',
      cell: (row) => (row.totalAmount ? `$${Number(row.totalAmount).toLocaleString()}` : '—'),
    },
    {
      id: 'currency',
      header: 'Currency',
      cell: (row) => row.currency,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <Badge variant={statusVariant[row.status] ?? 'default'}>{row.status}</Badge>,
    },
    {
      id: 'validUntil',
      header: 'Valid Until',
      cell: (row) => (row.validUntil ? new Date(row.validUntil).toLocaleDateString() : '—'),
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: (row) => (row.ownerId ? (userMap.get(row.ownerId) ?? '—') : '—'),
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
            <DropdownMenuItem asChild>
              <Link href={`/quotes/${row.id}`}>View</Link>
            </DropdownMenuItem>
            {row.status !== 'accepted' && row.status !== 'declined' && row.status !== 'expired' && (
              <DropdownMenuItem
                disabled={acceptMutation.isPending}
                onClick={() => acceptMutation.mutate({ id: row.id, source: 'crm' })}
              >
                Accept & Confirm
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setEditQuote(row)}>Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteQuote(row)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  function handleExport() {
    const items = quotes?.items ?? []
    exportToCsv(
      items,
      [
        { key: 'id', header: 'ID' },
        { key: 'quoteNumber', header: 'Quote Number' },
        { key: 'totalAmount', header: 'Amount' },
        { key: 'currency', header: 'Currency' },
        { key: 'status', header: 'Status' },
      ],
      'quotes',
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <fieldset className="inline-flex rounded-md border">
            <Button
              variant={viewMode === 'mine' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-r-none"
              onClick={() => setViewMode('mine')}
            >
              My Quotes
            </Button>
            <Button
              variant={viewMode === 'all' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-l-none"
              onClick={() => setViewMode('all')}
            >
              All Quotes
            </Button>
          </fieldset>
          <Button variant="outline" size="sm" onClick={handleExport}>
            Export CSV
          </Button>
        </div>
        <CreateQuoteDialog />
      </div>
      <DataTable columns={columns} data={quotes?.items ?? []} getRowKey={(row) => row.id} />
      {editQuote && (
        <EditQuoteDialog
          quote={editQuote}
          open={!!editQuote}
          onOpenChange={(open) => !open && setEditQuote(null)}
        />
      )}
      <Dialog open={!!deleteQuote} onOpenChange={(open) => !open && setDeleteQuote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Quote</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete quote &quot;{deleteQuote?.quoteNumber}&quot;? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteQuote(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteQuote && deleteMutation.mutate({ id: deleteQuote.id })}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

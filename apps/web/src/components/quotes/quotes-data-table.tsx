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
type UsersListOutput = inferRouterOutputs<AppRouter>['users']['list']

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

  const quotesRouter = trpc.quotes as NonNullable<typeof trpc.quotes>
  const usersRouter = trpc.users as NonNullable<typeof trpc.users>
  const listQuotes = quotesRouter.list as NonNullable<typeof quotesRouter.list>
  const listMineQuotes = quotesRouter.listMine as NonNullable<typeof quotesRouter.listMine>
  const deleteQuoteMutation = quotesRouter.delete as NonNullable<typeof quotesRouter.delete>
  const acceptQuote = quotesRouter.accept as NonNullable<typeof quotesRouter.accept>
  const listUsers = usersRouter.list as NonNullable<typeof usersRouter.list>

  const { data: allQuotesData } = listQuotes.useQuery(undefined, {
    initialData,
    refetchInterval: 60_000,
    enabled: viewMode === 'all',
  })
  const { data: myQuotesData } = listMineQuotes.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: viewMode === 'mine',
  })

  const quotesData = viewMode === 'mine' ? myQuotesData : allQuotesData
  const quotes = (quotesData as QuotesListOutput | undefined)?.items ?? []
  const { data: usersData } = listUsers.useQuery(undefined, { retry: false })
  const users = (usersData as UsersListOutput | undefined)?.items ?? []
  const [editQuote, setEditQuote] = useState<QuoteRow | null>(null)

  const userMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of users) {
      map.set(u.id, u.name ?? u.email)
    }
    return map
  }, [users])

  const utils = trpc.useUtils()
  const quotesUtils = utils.quotes as NonNullable<typeof utils.quotes>
  const ordersUtils = utils.orders as NonNullable<typeof utils.orders>
  const opportunitiesUtils = utils.opportunities as NonNullable<typeof utils.opportunities>
  const listQuotesUtils = quotesUtils.list as NonNullable<typeof quotesUtils.list>
  const listMineQuotesUtils = quotesUtils.listMine as NonNullable<typeof quotesUtils.listMine>
  const listOrdersUtils = ordersUtils.list as NonNullable<typeof ordersUtils.list>
  const listMineOrdersUtils = ordersUtils.listMine as NonNullable<typeof ordersUtils.listMine>
  const listOpportunitiesUtils = opportunitiesUtils.list as NonNullable<
    typeof opportunitiesUtils.list
  >
  const listMineOpportunitiesUtils = opportunitiesUtils.listMine as NonNullable<
    typeof opportunitiesUtils.listMine
  >
  const invalidateQuotes = () => {
    listQuotesUtils.invalidate()
    listMineQuotesUtils.invalidate()
  }
  const deleteMutation = deleteQuoteMutation.useMutation({
    onSuccess: () => {
      invalidateQuotes()
      setDeleteQuote(null)
    },
    onError: (err) => toast.error('Failed to delete quote', { description: err.message }),
  })
  const acceptMutation = acceptQuote.useMutation({
    onSuccess: () => {
      invalidateQuotes()
      listOrdersUtils.invalidate()
      listMineOrdersUtils.invalidate()
      listOpportunitiesUtils.invalidate()
      listMineOpportunitiesUtils.invalidate()
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
    const items = quotes
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
      <DataTable columns={columns} data={quotes} getRowKey={(row) => row.id} />
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

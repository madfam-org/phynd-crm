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
import type { AppRouter } from '@phyne/api'
import type { inferRouterOutputs } from '@trpc/server'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CreateOrderDialog } from './create-order-dialog'
import { EditOrderDialog } from './edit-order-dialog'

type OrdersListOutput = inferRouterOutputs<AppRouter>['orders']['list']
type OrderRow = OrdersListOutput['items'][number]

interface OrdersDataTableProps {
  initialData: OrdersListOutput
}

const statusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  cancelled: 'destructive',
  confirmed: 'default',
  fulfilled: 'success',
  in_production: 'warning',
  pending: 'secondary',
}

const paymentStatusVariant: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary' | 'warning'
> = {
  paid: 'success',
  partial: 'warning',
  refunded: 'destructive',
  unpaid: 'secondary',
}

type ViewMode = 'all' | 'mine'

export function OrdersDataTable({ initialData }: OrdersDataTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [deleteOrder, setDeleteOrder] = useState<OrderRow | null>(null)

  const { data: allOrders } = trpc.orders.list.useQuery(undefined, {
    initialData,
    refetchInterval: 60_000,
    enabled: viewMode === 'all',
  })
  const { data: myOrders } = trpc.orders.listMine.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: viewMode === 'mine',
  })

  const orders = viewMode === 'mine' ? myOrders : allOrders
  const { data: usersData } = trpc.users.list.useQuery(undefined, { retry: false })
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null)

  const userMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of usersData?.items ?? []) {
      map.set(u.id, u.name ?? u.email)
    }
    return map
  }, [usersData])

  const utils = trpc.useUtils()
  const invalidateOrders = () => {
    utils.orders.list.invalidate()
    utils.orders.listMine.invalidate()
  }
  const deleteMutation = trpc.orders.delete.useMutation({
    onSuccess: () => {
      invalidateOrders()
      setDeleteOrder(null)
    },
    onError: (err) => toast.error('Failed to delete order', { description: err.message }),
  })

  const columns: ColumnDef<OrderRow>[] = [
    {
      id: 'orderNumber',
      header: 'Order #',
      cell: (row) => (
        <Link href={`/orders/${row.id}`} className="font-medium text-primary hover:underline">
          {row.orderNumber}
        </Link>
      ),
    },
    {
      id: 'totalAmount',
      header: 'Amount',
      cell: (row) => (row.totalAmount ? `$${Number(row.totalAmount).toLocaleString()}` : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={statusVariant[row.status] ?? 'default'}>
          {row.status.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      id: 'paymentStatus',
      header: 'Payment',
      cell: (row) => (
        <Badge variant={paymentStatusVariant[row.paymentStatus] ?? 'default'}>
          {row.paymentStatus.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      id: 'estimatedCompletion',
      header: 'Est. Completion',
      cell: (row) =>
        row.estimatedCompletion ? new Date(row.estimatedCompletion).toLocaleDateString() : '—',
    },
    {
      id: 'actualCompletion',
      header: 'Actual Completion',
      cell: (row) =>
        row.actualCompletion ? new Date(row.actualCompletion).toLocaleDateString() : '—',
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
              <Link href={`/orders/${row.id}`}>View</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditOrder(row)}>Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteOrder(row)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  function handleExport() {
    const items = orders?.items ?? []
    exportToCsv(
      items,
      [
        { key: 'id', header: 'ID' },
        { key: 'orderNumber', header: 'Order Number' },
        { key: 'totalAmount', header: 'Amount' },
        { key: 'status', header: 'Status' },
        { key: 'paymentStatus', header: 'Payment Status' },
      ],
      'orders',
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
              My Orders
            </Button>
            <Button
              variant={viewMode === 'all' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-l-none"
              onClick={() => setViewMode('all')}
            >
              All Orders
            </Button>
          </fieldset>
          <Button variant="outline" size="sm" onClick={handleExport}>
            Export CSV
          </Button>
        </div>
        <CreateOrderDialog />
      </div>
      <DataTable columns={columns} data={orders?.items ?? []} getRowKey={(row) => row.id} />
      {editOrder && (
        <EditOrderDialog
          order={editOrder}
          open={!!editOrder}
          onOpenChange={(open) => !open && setEditOrder(null)}
        />
      )}
      <Dialog open={!!deleteOrder} onOpenChange={(open) => !open && setDeleteOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete order &quot;{deleteOrder?.orderNumber}&quot;? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOrder(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteOrder && deleteMutation.mutate({ id: deleteOrder.id })}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

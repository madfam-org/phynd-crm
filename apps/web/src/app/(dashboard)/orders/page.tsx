import { OrdersDataTable } from '@/components/orders/orders-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function OrdersPage() {
  const caller = await getServerCaller()
  const orders = await caller.orders.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Orders</h1>
        <p className="text-muted-foreground">Track your fulfillment orders</p>
      </div>
      <OrdersDataTable initialData={orders} />
    </div>
  )
}

import { OffersDataTable } from '@/components/offers/offers-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function OffersPage() {
  const caller = await getServerCaller()
  const offers = await caller.offers.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Offers</h1>
        <p className="text-muted-foreground">Manage offers linked to Cotiza and Forj products</p>
      </div>
      <OffersDataTable initialData={offers} />
    </div>
  )
}

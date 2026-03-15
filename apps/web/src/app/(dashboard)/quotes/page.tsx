import { QuotesDataTable } from '@/components/quotes/quotes-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function QuotesPage() {
  const caller = await getServerCaller()
  const quotes = await caller.quotes.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Quotes</h1>
        <p className="text-muted-foreground">Manage your sales quotes</p>
      </div>
      <QuotesDataTable initialData={quotes} />
    </div>
  )
}

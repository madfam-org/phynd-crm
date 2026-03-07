import { Badge } from '@/components/ui/badge'
import { getServerCaller } from '@/lib/trpc/server'
import Link from 'next/link'

export default async function ClientsPage() {
  const caller = await getServerCaller()
  const contacts = await caller.contacts.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Clients</h1>
        <p className="text-muted-foreground">Manage your client relationships</p>
      </div>
      <div className="space-y-2">
        {contacts.map((contact) => (
          <Link
            key={contact.id}
            href={`/clients/${contact.id}`}
            className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent"
          >
            <div>
              <p className="font-medium">{contact.name}</p>
              <p className="text-sm text-muted-foreground">
                {contact.email ?? contact.company ?? '—'}
              </p>
            </div>
            <Badge variant={contact.status === 'active' ? 'success' : 'secondary'}>
              {contact.status}
            </Badge>
          </Link>
        ))}
        {contacts.length === 0 && (
          <p className="text-center text-muted-foreground">No clients found.</p>
        )}
      </div>
    </div>
  )
}

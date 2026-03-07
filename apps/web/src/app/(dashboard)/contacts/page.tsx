import { ContactsDataTable } from '@/components/contacts/contacts-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function ContactsPage() {
  const caller = await getServerCaller()
  const contacts = await caller.contacts.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Contacts</h1>
        <p className="text-muted-foreground">View and manage contacts</p>
      </div>
      <ContactsDataTable initialData={contacts} />
    </div>
  )
}

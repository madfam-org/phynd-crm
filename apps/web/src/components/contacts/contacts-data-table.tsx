'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
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
import { CreateContactDialog } from './create-contact-dialog'
import { DeleteContactDialog } from './delete-contact-dialog'
import { EditContactDialog } from './edit-contact-dialog'

type ContactRow = inferRouterOutputs<AppRouter>['contacts']['list'][number]

interface ContactsDataTableProps {
  initialData: ContactRow[]
}

export function ContactsDataTable({ initialData }: ContactsDataTableProps) {
  const { data: contacts } = trpc.contacts.list.useQuery(undefined, {
    initialData,
  })
  const [editContact, setEditContact] = useState<ContactRow | null>(null)
  const [deleteContact, setDeleteContact] = useState<ContactRow | null>(null)

  const columns: ColumnDef<ContactRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    { id: 'email', header: 'Email', cell: (row) => row.email ?? '—' },
    { id: 'phone', header: 'Phone', cell: (row) => row.phone ?? '—' },
    { id: 'company', header: 'Company', cell: (row) => row.company ?? '—' },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => {
        const variant =
          row.status === 'active' ? 'success' : row.status === 'archived' ? 'secondary' : 'warning'
        return <Badge variant={variant}>{row.status}</Badge>
      },
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
            <DropdownMenuItem onClick={() => setEditContact(row)}>Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteContact(row)}>
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
        <CreateContactDialog />
      </div>
      <DataTable columns={columns} data={contacts ?? []} getRowKey={(row) => row.id} />
      {editContact && (
        <EditContactDialog
          contact={editContact}
          open={!!editContact}
          onOpenChange={(open) => !open && setEditContact(null)}
        />
      )}
      {deleteContact && (
        <DeleteContactDialog
          contactId={deleteContact.id}
          contactName={deleteContact.name}
          open={!!deleteContact}
          onOpenChange={(open) => !open && setDeleteContact(null)}
        />
      )}
    </div>
  )
}

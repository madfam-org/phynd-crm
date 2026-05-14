'use client'

import { Badge } from '@/components/ui/badge'
import { BulkActionsToolbar } from '@/components/ui/bulk-actions-toolbar'
import { Button } from '@/components/ui/button'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
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
import { useState } from 'react'
import { CreateContactDialog } from './create-contact-dialog'
import { DeleteContactDialog } from './delete-contact-dialog'
import { EditContactDialog } from './edit-contact-dialog'

type ContactsListOutput = inferRouterOutputs<AppRouter>['contacts']['list']
type ContactRow = ContactsListOutput['items'][number]

interface ContactsDataTableProps {
  initialData: ContactsListOutput
}

export function ContactsDataTable({ initialData }: ContactsDataTableProps) {
  const contactsRouter = trpc.contacts as NonNullable<typeof trpc.contacts>
  const listContacts = contactsRouter.list as NonNullable<typeof contactsRouter.list>
  const { data: contacts } = listContacts.useQuery(undefined, {
    initialData,
    refetchInterval: 120_000,
  })
  const [editContact, setEditContact] = useState<ContactRow | null>(null)
  const [deleteContact, setDeleteContact] = useState<ContactRow | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set())

  function handleExport() {
    const items = contacts?.items ?? []
    const toExport =
      selectedKeys.size > 0 ? items.filter((c: ContactRow) => selectedKeys.has(c.id)) : items
    exportToCsv(
      toExport,
      [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'email', header: 'Email' },
        { key: 'phone', header: 'Phone' },
        { key: 'company', header: 'Company' },
        { key: 'status', header: 'Status' },
      ],
      'contacts',
    )
  }

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
      <div className="flex items-center justify-between">
        <BulkActionsToolbar
          selectedCount={selectedKeys.size}
          onExport={handleExport}
          showStatusAction={false}
        />
        <CreateContactDialog />
      </div>
      <DataTable
        columns={columns}
        data={contacts?.items ?? []}
        getRowKey={(row) => row.id}
        searchKey="name"
        searchPlaceholder="Search contacts..."
        selectable
        onSelectionChange={setSelectedKeys}
      />
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

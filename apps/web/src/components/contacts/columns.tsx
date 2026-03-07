'use client'

import { Badge } from '@/components/ui/badge'
import type { ColumnDef } from '@/components/ui/data-table'

interface ContactRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  status: string
}

export type { ContactRow }

export const contactColumns: ColumnDef<ContactRow>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name },
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
]

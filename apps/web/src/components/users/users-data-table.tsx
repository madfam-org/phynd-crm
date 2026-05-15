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
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'
import { CreateUserDialog } from './create-user-dialog'
import { EditUserDialog } from './edit-user-dialog'

type UsersListOutput = inferRouterOutputs<AppRouter>['users']['list']
type UserRow = UsersListOutput['items'][number]

interface UsersDataTableProps {
  initialData: UsersListOutput
}

const roleVariant: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  admin: 'default',
  manager: 'success',
  sales_rep: 'warning',
  viewer: 'secondary',
}

const roleLabel: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  sales_rep: 'Sales Rep',
  viewer: 'Viewer',
}

export function UsersDataTable({ initialData }: UsersDataTableProps) {
  const usersRouter = trpc.users as NonNullable<typeof trpc.users>
  const listUsers = usersRouter.list as NonNullable<typeof usersRouter.list>
  const deleteUser = usersRouter.delete as NonNullable<typeof usersRouter.delete>
  const { data: usersData } = listUsers.useQuery(undefined, {
    initialData,
    refetchInterval: 120_000,
  })
  const users = (usersData as UsersListOutput | undefined) ?? initialData
  const [editUser, setEditUser] = useState<UserRow | null>(null)

  const utils = trpc.useUtils()
  const usersUtils = utils.users as NonNullable<typeof utils.users>
  const listUsersUtils = usersUtils.list as NonNullable<typeof usersUtils.list>
  const deleteMutation = deleteUser.useMutation({
    onSuccess: () => {
      listUsersUtils.invalidate()
      toast.success('User deleted')
    },
    onError: (err) => toast.error('Failed to delete user', { description: err.message }),
  })

  const columns: ColumnDef<UserRow>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (row) => row.name ?? '—',
    },
    {
      id: 'email',
      header: 'Email',
      cell: (row) => row.email,
    },
    {
      id: 'role',
      header: 'Role',
      cell: (row) => (
        <Badge variant={roleVariant[row.role] ?? 'default'}>
          {roleLabel[row.role] ?? row.role}
        </Badge>
      ),
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (row) =>
        row.createdAt
          ? new Date(row.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
          : '—',
    },
    {
      id: 'actions',
      header: '',
      className: 'w-[50px]',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="User actions" variant="ghost" size="sm">
              ...
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditUser(row)}>Edit</DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => deleteMutation.mutate({ id: row.id })}
            >
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
        <CreateUserDialog />
      </div>
      <DataTable
        columns={columns}
        data={users.items}
        getRowKey={(row) => row.id}
        searchKey="email"
        searchPlaceholder="Search by email..."
        filterKey="role"
        filterLabel="Filter by role"
        filterOptions={[
          { label: 'Admin', value: 'admin' },
          { label: 'Manager', value: 'manager' },
          { label: 'Sales Rep', value: 'sales_rep' },
          { label: 'Viewer', value: 'viewer' },
        ]}
      />
      {editUser && (
        <EditUserDialog
          user={editUser}
          open={!!editUser}
          onOpenChange={(open) => !open && setEditUser(null)}
        />
      )}
    </div>
  )
}

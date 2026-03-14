import { UsersDataTable } from '@/components/users/users-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function UsersPage() {
  const caller = await getServerCaller()
  const users = await caller.users.list()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Users</h1>
        <p className="text-muted-foreground">Manage user accounts</p>
      </div>
      <UsersDataTable initialData={users} />
    </div>
  )
}

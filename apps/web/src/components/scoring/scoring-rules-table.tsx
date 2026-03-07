'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ColumnDef } from '@/components/ui/data-table'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import { toast } from 'sonner'

type RuleRow = inferRouterOutputs<AppRouter>['leadScoring']['listRules'][number]

interface ScoringRulesTableProps {
  initialData: RuleRow[]
}

const categoryVariant: Record<string, 'default' | 'success' | 'warning'> = {
  demographic: 'default',
  behavior: 'warning',
  engagement: 'success',
}

export function ScoringRulesTable({ initialData }: ScoringRulesTableProps) {
  const { data: rules } = trpc.leadScoring.listRules.useQuery(undefined, { initialData })
  const [createOpen, setCreateOpen] = useState(false)

  const utils = trpc.useUtils()
  const deleteMutation = trpc.leadScoring.deleteRule.useMutation({
    onSuccess: () => utils.leadScoring.listRules.invalidate(),
    onError: (err) => toast.error('Failed to delete rule', { description: err.message }),
  })

  const createMutation = trpc.leadScoring.createRule.useMutation({
    onSuccess: () => {
      utils.leadScoring.listRules.invalidate()
      setCreateOpen(false)
    },
    onError: (err) => toast.error('Failed to create rule', { description: err.message }),
  })

  const columns: ColumnDef<RuleRow>[] = [
    {
      id: 'name',
      header: 'Rule',
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'category',
      header: 'Category',
      cell: (row) => (
        <Badge variant={categoryVariant[row.category] ?? 'default'}>{row.category}</Badge>
      ),
    },
    {
      id: 'points',
      header: 'Points',
      cell: (row) => (
        <span className={row.points >= 0 ? 'text-green-600' : 'text-red-600'}>
          {row.points > 0 ? '+' : ''}
          {row.points}
        </span>
      ),
    },
    {
      id: 'active',
      header: 'Active',
      cell: (row) => (
        <Badge variant={row.isActive ? 'success' : 'secondary'}>
          {row.isActive ? 'Yes' : 'No'}
        </Badge>
      ),
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
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>Add Rule</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Scoring Rule</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                createMutation.mutate({
                  name: fd.get('name') as string,
                  category: fd.get('category') as 'demographic' | 'behavior' | 'engagement',
                  points: Number(fd.get('points')),
                  condition: {
                    field: fd.get('field') as string,
                    operator: fd.get('operator') as
                      | 'eq'
                      | 'gt'
                      | 'lt'
                      | 'gte'
                      | 'lte'
                      | 'contains'
                      | 'exists',
                    value: fd.get('conditionValue') as string,
                  },
                })
              }}
            >
              <input
                name="name"
                placeholder="Rule name"
                required
                className="w-full rounded border px-3 py-2"
              />
              <select name="category" className="w-full rounded border px-3 py-2">
                <option value="demographic">Demographic</option>
                <option value="behavior">Behavior</option>
                <option value="engagement">Engagement</option>
              </select>
              <input
                name="field"
                placeholder="Field (e.g. source, session_count)"
                required
                className="w-full rounded border px-3 py-2"
              />
              <select name="operator" className="w-full rounded border px-3 py-2">
                <option value="eq">Equals</option>
                <option value="gt">Greater than</option>
                <option value="lt">Less than</option>
                <option value="gte">Greater or equal</option>
                <option value="lte">Less or equal</option>
                <option value="contains">Contains</option>
                <option value="exists">Exists</option>
              </select>
              <input
                name="conditionValue"
                placeholder="Value"
                className="w-full rounded border px-3 py-2"
              />
              <input
                name="points"
                type="number"
                placeholder="Points"
                required
                className="w-full rounded border px-3 py-2"
              />
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Rule'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <DataTable columns={columns} data={rules ?? []} getRowKey={(row) => row.id} />
    </div>
  )
}

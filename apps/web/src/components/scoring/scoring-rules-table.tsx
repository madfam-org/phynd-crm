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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'
import { DeleteScoringRuleDialog } from './delete-scoring-rule-dialog'
import { EditScoringRuleDialog } from './edit-scoring-rule-dialog'

type RulesListOutput = inferRouterOutputs<AppRouter>['leadScoring']['listRules']
type RuleRow = RulesListOutput['items'][number]

interface ScoringRulesTableProps {
  initialData: RulesListOutput
}

const categoryVariant: Record<string, 'default' | 'success' | 'warning'> = {
  demographic: 'default',
  behavior: 'warning',
  engagement: 'success',
}

export function ScoringRulesTable({ initialData }: ScoringRulesTableProps) {
  const { data: rules } = trpc.leadScoring.listRules.useQuery(undefined, { initialData })
  const [createOpen, setCreateOpen] = useState(false)
  const [editRule, setEditRule] = useState<RuleRow | null>(null)
  const [deleteRule, setDeleteRule] = useState<RuleRow | null>(null)
  const [category, setCategory] = useState<string>('demographic')
  const [operator, setOperator] = useState<string>('eq')

  const utils = trpc.useUtils()
  const createMutation = trpc.leadScoring.createRule.useMutation({
    onSuccess: () => {
      utils.leadScoring.listRules.invalidate()
      setCreateOpen(false)
      setCategory('demographic')
      setOperator('eq')
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
            <DropdownMenuItem onClick={() => setEditRule(row)}>Edit</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteRule(row)}>
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
                  category: category as 'demographic' | 'behavior' | 'engagement',
                  points: Number(fd.get('points')),
                  condition: {
                    field: fd.get('field') as string,
                    operator: operator as
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
              <div className="space-y-1">
                <Label htmlFor="rule-name">Rule name</Label>
                <Input id="rule-name" name="name" placeholder="Rule name" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="rule-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="demographic">Demographic</SelectItem>
                    <SelectItem value="behavior">Behavior</SelectItem>
                    <SelectItem value="engagement">Engagement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-field">Condition field</Label>
                <Input
                  id="rule-field"
                  name="field"
                  placeholder="Field (e.g. source, session_count)"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-operator">Operator</Label>
                <Select value={operator} onValueChange={setOperator}>
                  <SelectTrigger id="rule-operator">
                    <SelectValue placeholder="Select operator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eq">Equals</SelectItem>
                    <SelectItem value="gt">Greater than</SelectItem>
                    <SelectItem value="lt">Less than</SelectItem>
                    <SelectItem value="gte">Greater or equal</SelectItem>
                    <SelectItem value="lte">Less or equal</SelectItem>
                    <SelectItem value="contains">Contains</SelectItem>
                    <SelectItem value="exists">Exists</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-value">Condition value</Label>
                <Input id="rule-value" name="conditionValue" placeholder="Value" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-points">Points</Label>
                <Input id="rule-points" name="points" type="number" placeholder="Points" required />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Rule'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <DataTable columns={columns} data={rules?.items ?? []} getRowKey={(row) => row.id} />
      {editRule && (
        <EditScoringRuleDialog
          rule={editRule}
          open={!!editRule}
          onOpenChange={(open) => !open && setEditRule(null)}
        />
      )}
      {deleteRule && (
        <DeleteScoringRuleDialog
          ruleId={deleteRule.id}
          ruleName={deleteRule.name}
          open={!!deleteRule}
          onOpenChange={(open) => !open && setDeleteRule(null)}
        />
      )}
    </div>
  )
}

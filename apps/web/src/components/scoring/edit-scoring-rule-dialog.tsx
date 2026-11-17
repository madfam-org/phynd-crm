'use client'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useState } from 'react'
import { toast } from 'sonner'
import { formatConditionValue, parseConditionValue } from './condition-value'

interface EditScoringRuleDialogProps {
  rule: {
    id: string
    name: string
    category: string
    condition: { field: string; operator: string; value?: unknown } | unknown
    points: number
    isActive: boolean
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

function getConditionField(condition: unknown): string {
  if (condition && typeof condition === 'object' && 'field' in condition) {
    return String((condition as { field: unknown }).field)
  }
  return ''
}

function getConditionOperator(condition: unknown): string {
  if (condition && typeof condition === 'object' && 'operator' in condition) {
    return String((condition as { operator: unknown }).operator)
  }
  return 'eq'
}

function getConditionRawValue(condition: unknown): unknown {
  if (condition && typeof condition === 'object' && 'value' in condition) {
    return (condition as { value: unknown }).value
  }
  return undefined
}

/** Further conditions (`all`) are not edited here; they are kept as they are. */
function getConditionAll(condition: unknown) {
  if (condition && typeof condition === 'object' && 'all' in condition) {
    const all = (condition as { all: unknown }).all
    return Array.isArray(all)
      ? (all as { field: string; operator: ScoringOperator; value?: unknown }[])
      : undefined
  }
  return undefined
}

type ScoringOperator = 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'exists' | 'in'

export function EditScoringRuleDialog({ rule, open, onOpenChange }: EditScoringRuleDialogProps) {
  const [name, setName] = useState(rule.name)
  const [category, setCategory] = useState(rule.category)
  const [field, setField] = useState(getConditionField(rule.condition))
  const [operator, setOperator] = useState(getConditionOperator(rule.condition))
  const [conditionValue, setConditionValue] = useState(
    formatConditionValue(getConditionRawValue(rule.condition)),
  )
  const [points, setPoints] = useState(String(rule.points))
  const [isActive, setIsActive] = useState(rule.isActive)

  const utils = trpc.useUtils()
  const leadScoringRouter = trpc.leadScoring as NonNullable<typeof trpc.leadScoring>
  const updateRule = leadScoringRouter.updateRule as NonNullable<
    typeof leadScoringRouter.updateRule
  >
  const leadScoringUtils = utils.leadScoring as NonNullable<typeof utils.leadScoring>
  const listRulesUtils = leadScoringUtils.listRules as NonNullable<
    typeof leadScoringUtils.listRules
  >
  const updateMutation = updateRule.useMutation({
    onSuccess: () => {
      listRulesUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to update rule', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: rule.id,
      name,
      category: category as 'demographic' | 'behavior' | 'engagement',
      condition: {
        field,
        operator: operator as ScoringOperator,
        value: parseConditionValue(conditionValue, operator, getConditionRawValue(rule.condition)),
        ...(getConditionAll(rule.condition) ? { all: getConditionAll(rule.condition) } : {}),
      },
      points: Number(points),
      isActive,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Scoring Rule</DialogTitle>
            <DialogDescription>Update the scoring rule configuration.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-rule-name">Name *</Label>
              <Input
                id="edit-rule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-rule-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="edit-rule-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="demographic">Demographic</SelectItem>
                  <SelectItem value="behavior">Behavior</SelectItem>
                  <SelectItem value="engagement">Engagement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-rule-field">Condition field</Label>
              <Input
                id="edit-rule-field"
                value={field}
                onChange={(e) => setField(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-rule-operator">Operator</Label>
              <Select value={operator} onValueChange={setOperator}>
                <SelectTrigger id="edit-rule-operator">
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
                  <SelectItem value="in">One of (comma list)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-rule-value">Condition value</Label>
              <Input
                id="edit-rule-value"
                value={conditionValue}
                onChange={(e) => setConditionValue(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-rule-points">Points *</Label>
              <Input
                id="edit-rule-points"
                type="number"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-rule-active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
              />
              <Label htmlFor="edit-rule-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

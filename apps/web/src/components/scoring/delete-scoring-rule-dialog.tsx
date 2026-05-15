'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { trpc } from '@/lib/trpc/client'
import { toast } from 'sonner'

interface DeleteScoringRuleDialogProps {
  ruleId: string
  ruleName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteScoringRuleDialog({
  ruleId,
  ruleName,
  open,
  onOpenChange,
}: DeleteScoringRuleDialogProps) {
  const utils = trpc.useUtils()
  const leadScoringRouter = trpc.leadScoring as NonNullable<typeof trpc.leadScoring>
  const deleteRule = leadScoringRouter.deleteRule as NonNullable<
    typeof leadScoringRouter.deleteRule
  >
  const leadScoringUtils = utils.leadScoring as NonNullable<typeof utils.leadScoring>
  const listRulesUtils = leadScoringUtils.listRules as NonNullable<
    typeof leadScoringUtils.listRules
  >
  const deleteMutation = deleteRule.useMutation({
    onSuccess: () => {
      listRulesUtils.invalidate()
      onOpenChange(false)
    },
    onError: (err) => toast.error('Failed to delete rule', { description: err.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Scoring Rule</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{ruleName}</strong>? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate({ id: ruleId })}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

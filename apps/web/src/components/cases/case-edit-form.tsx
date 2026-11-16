'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import type { CaseStatus, CaseType } from '@phynd/db/schema'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  CASE_STATUS_LABELS,
  CASE_TYPE_LABELS,
  fromMexicoCityLocal,
  toDateTimeLocal,
} from './case-labels'

const TYPE_OPTIONS = Object.keys(CASE_TYPE_LABELS) as CaseType[]
const STATUS_OPTIONS = Object.keys(CASE_STATUS_LABELS) as CaseStatus[]

interface CaseEditFormProps {
  row: {
    id: string
    type: string
    summary: string
    status: string
    dueAt: Date | string
  }
}

/** Edit a case: type, summary, status and due date. Saving refreshes the page. */
export function CaseEditForm({ row }: CaseEditFormProps) {
  const router = useRouter()
  const [type, setType] = useState(row.type as CaseType)
  const [status, setStatus] = useState(row.status as CaseStatus)
  const [summary, setSummary] = useState(row.summary)
  const [dueAt, setDueAt] = useState(toDateTimeLocal(row.dueAt))

  const utils = trpc.useUtils()
  const casesRouter = trpc.cases as NonNullable<typeof trpc.cases>
  const updateCase = casesRouter.update as NonNullable<typeof casesRouter.update>
  const casesUtils = utils.cases as NonNullable<typeof utils.cases>
  const updateMutation = updateCase.useMutation({
    onSuccess: () => {
      casesUtils.list.invalidate()
      toast.success('Caso actualizado')
      router.refresh()
    },
    onError: (err) => toast.error('No se pudo guardar el caso', { description: err.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate({
      id: row.id,
      type,
      status,
      summary,
      ...(dueAt ? { dueAt: fromMexicoCityLocal(dueAt) } : {}),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="case-edit-status">Estado</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as CaseStatus)}>
            <SelectTrigger id="case-edit-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {CASE_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="case-edit-type">Tipo</Label>
          <Select value={type} onValueChange={(value) => setType(value as CaseType)}>
            <SelectTrigger id="case-edit-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {CASE_TYPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="case-edit-due">Fecha límite (hora de la Ciudad de México)</Label>
        <Input
          id="case-edit-due"
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          Cambiar el tipo no recalcula la fecha límite.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="case-edit-summary">Resumen</Label>
        <Textarea
          id="case-edit-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={5}
          maxLength={5000}
          required
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={updateMutation.isPending || !summary.trim() || !dueAt}>
          {updateMutation.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  )
}

'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc/client'
import type { CaseType } from '@phynd/db/schema'
import { CASE_DEFAULT_DUE_BUSINESS_DAYS } from '@phynd/services/cases/case-deadlines'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { CASE_TYPE_LABELS } from './case-labels'

// Client bundle: the values come from the label map (typed by the schema), not
// from the schema module itself, which is server-only.
const CASE_TYPE_OPTIONS = Object.keys(CASE_TYPE_LABELS) as CaseType[]

export function CreateCaseDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [contactId, setContactId] = useState('')
  const [type, setType] = useState<CaseType>('support')
  const [summary, setSummary] = useState('')
  const [dueAt, setDueAt] = useState('')

  const contactsQuery = trpc.contacts.list.useQuery({ limit: 200 }, { enabled: open })
  const contacts = contactsQuery.data?.items ?? []

  const utils = trpc.useUtils()
  const casesRouter = trpc.cases as NonNullable<typeof trpc.cases>
  const createCase = casesRouter.create as NonNullable<typeof casesRouter.create>
  const casesUtils = utils.cases as NonNullable<typeof utils.cases>
  const createMutation = createCase.useMutation({
    onSuccess: (created) => {
      casesUtils.list.invalidate()
      setOpen(false)
      resetForm()
      toast.success('Caso abierto')
      router.push(`/cases/${created.id}`)
    },
    onError: (err) => toast.error('No se pudo abrir el caso', { description: err.message }),
  })

  function resetForm() {
    setContactId('')
    setType('support')
    setSummary('')
    setDueAt('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate({
      contactId,
      type,
      summary,
      dueAt: dueAt ? new Date(dueAt) : undefined,
    })
  }

  const defaultDays = CASE_DEFAULT_DUE_BUSINESS_DAYS[type]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Abrir caso</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Abrir caso</DialogTitle>
            <DialogDescription>
              Una solicitud de un contacto que tiene fecha límite.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="case-contact">Contacto *</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger id="case-contact">
                  <SelectValue
                    placeholder={contactsQuery.isLoading ? 'Cargando…' : 'Elige un contacto'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.email ? ` · ${c.email}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="case-type">Tipo *</Label>
              <Select value={type} onValueChange={(value) => setType(value as CaseType)}>
                <SelectTrigger id="case-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_TYPE_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CASE_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="case-summary">Resumen *</Label>
              <Textarea
                id="case-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={4}
                maxLength={5000}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="case-due">Fecha límite</Label>
              <Input
                id="case-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Si la dejas vacía: {String(defaultDays)} días hábiles a partir de hoy.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || !contactId || !summary.trim()}
            >
              {createMutation.isPending ? 'Abriendo…' : 'Abrir caso'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

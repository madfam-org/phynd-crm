import { CaseEditForm } from '@/components/cases/case-edit-form'
import {
  CaseOverdueBadge,
  CaseStatusBadge,
  caseTypeLabel,
  formatCaseDate,
} from '@/components/cases/case-labels'
import { getServerCaller } from '@/lib/trpc/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

interface CasePageProps {
  params: Promise<{ id: string }>
}

export default async function CasePage({ params }: CasePageProps) {
  const { id } = await params
  const caller = await getServerCaller()
  const row = await caller.cases.getById({ id })
  if (!row) notFound()

  const facts: Array<[string, string]> = [
    ['Tipo', caseTypeLabel(row.type)],
    ['Abierto', formatCaseDate(row.openedAt)],
    ['Fecha límite', formatCaseDate(row.dueAt)],
    ['Resuelto', formatCaseDate(row.resolvedAt)],
  ]

  return (
    <div className="space-y-6">
      <div>
        <Link href="/cases" className="text-sm text-muted-foreground hover:underline">
          ← Casos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold">Caso</h1>
          <CaseStatusBadge status={row.status} />
          <CaseOverdueBadge row={row} />
        </div>
        <p className="text-muted-foreground">
          {row.contactName ? (
            <Link href={`/clients/${row.contactId}`} className="hover:underline">
              {row.contactName}
            </Link>
          ) : (
            'Contacto eliminado'
          )}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <dl className="grid gap-4 sm:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Editar</h2>
        <CaseEditForm row={row} />
      </div>
    </div>
  )
}

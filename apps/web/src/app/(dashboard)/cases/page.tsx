import { CasesDataTable } from '@/components/cases/cases-data-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function CasesPage() {
  const caller = await getServerCaller()
  const cases = await caller.cases.list({ unresolved: true, limit: 200 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Casos</h1>
        <p className="text-muted-foreground">
          Solicitudes de contactos con fecha límite: soporte, reembolsos, derechos ARCO y
          correcciones de factura.
        </p>
      </div>
      <CasesDataTable initialData={cases} />
    </div>
  )
}

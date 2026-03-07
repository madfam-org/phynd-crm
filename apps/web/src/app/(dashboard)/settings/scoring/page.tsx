import { ScoringRulesTable } from '@/components/scoring/scoring-rules-table'
import { getServerCaller } from '@/lib/trpc/server'

export default async function ScoringSettingsPage() {
  const caller = await getServerCaller()
  const rules = await caller.leadScoring.listRules()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Lead Scoring Rules</h1>
        <p className="text-muted-foreground">Configure rules for automatic lead scoring</p>
      </div>
      <ScoringRulesTable initialData={rules} />
    </div>
  )
}

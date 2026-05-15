'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { trpc } from '@/lib/trpc/client'
import type { AppRouter } from '@phynd/api'
import type { inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import { toast } from 'sonner'

const DEFAULT_PANELS = ['janua', 'dhanam', 'cotiza', 'pravara', 'forj', 'tezca', 'janua-telemetry']
type PreferencesForRoleOutput = inferRouterOutputs<AppRouter>['preferences']['getForRole']

export function PanelOrderSettings() {
  const preferencesRouter = trpc.preferences as NonNullable<typeof trpc.preferences>
  const getPreferencesForRole = preferencesRouter.getForRole as NonNullable<
    typeof preferencesRouter.getForRole
  >
  const upsertPreferences = preferencesRouter.upsert as NonNullable<typeof preferencesRouter.upsert>
  const { data: prefsData, isLoading } = getPreferencesForRole.useQuery({ role: 'admin' })
  const prefs = prefsData as PreferencesForRoleOutput | undefined
  const [panelOrder, setPanelOrder] = useState<string[]>([])
  const [defaultTab, setDefaultTab] = useState('')
  const [initialized, setInitialized] = useState(false)

  const utils = trpc.useUtils()
  const preferencesUtils = utils.preferences as NonNullable<typeof utils.preferences>
  const getPreferencesForRoleUtils = preferencesUtils.getForRole as NonNullable<
    typeof preferencesUtils.getForRole
  >
  const upsertMutation = upsertPreferences.useMutation({
    onSuccess: () => {
      getPreferencesForRoleUtils.invalidate()
      toast.success('Preferences saved')
    },
    onError: (err) => toast.error('Failed to save', { description: err.message }),
  })

  if (!initialized && prefs !== undefined) {
    setPanelOrder(prefs?.panelOrder ?? DEFAULT_PANELS)
    setDefaultTab(prefs?.defaultTab ?? '')
    setInitialized(true)
  }

  const moveUp = (index: number) => {
    if (index === 0) return
    const next = [...panelOrder]
    const tmp = next[index - 1]
    next[index - 1] = next[index] as string
    next[index] = tmp as string
    setPanelOrder(next)
  }

  const moveDown = (index: number) => {
    if (index >= panelOrder.length - 1) return
    const next = [...panelOrder]
    const tmp = next[index + 1]
    next[index + 1] = next[index] as string
    next[index] = tmp as string
    setPanelOrder(next)
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border p-6">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Panel Order</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Customize the order of federation panels in client profiles
          </p>
        </div>
        <div className="space-y-2">
          {panelOrder.map((panel, index) => (
            <div key={panel} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="flex-1 text-sm font-medium capitalize">{panel}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => moveUp(index)}
                disabled={index === 0}
                aria-label={`Move ${panel} up`}
              >
                Up
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => moveDown(index)}
                disabled={index >= panelOrder.length - 1}
                aria-label={`Move ${panel} down`}
              >
                Down
              </Button>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Default Tab</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which tab opens by default in client profiles
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="default-tab">Tab name</Label>
          <Input
            id="default-tab"
            value={defaultTab}
            onChange={(e) => setDefaultTab(e.target.value)}
            placeholder="e.g. overview"
          />
        </div>
      </div>
      <Button
        onClick={() =>
          upsertMutation.mutate({
            role: 'admin',
            panelOrder,
            defaultTab: defaultTab || null,
          })
        }
        disabled={upsertMutation.isPending}
      >
        {upsertMutation.isPending ? 'Saving...' : 'Save Preferences'}
      </Button>
    </div>
  )
}

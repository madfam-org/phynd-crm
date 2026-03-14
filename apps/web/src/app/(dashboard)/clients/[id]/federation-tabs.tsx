'use client'

import { FederationErrorBoundary } from '@/components/federation/error-boundary'
import { FederationPanel } from '@/components/federation/federation-panel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { FederationProviderName } from '@phyne/types/crm'
import type { ProviderStatus } from '@phyne/types/federation'

interface FederationPanelConfig {
  provider: FederationProviderName
  title: string
  tabLabel: string
  tabValue: string
  status: ProviderStatus
  data: unknown
  error: string | null
  cachedAt: Date | null
}

interface FederationTabsProps {
  panels: FederationPanelConfig[]
}

function FederationTabPanel({ panel }: { panel: FederationPanelConfig }) {
  return (
    <FederationErrorBoundary provider={panel.provider}>
      <FederationPanel
        provider={panel.provider}
        title={panel.title}
        status={panel.status}
        data={panel.data}
        error={panel.error}
        cachedAt={panel.cachedAt}
      />
    </FederationErrorBoundary>
  )
}

export function FederationTabs({ panels }: FederationTabsProps) {
  if (panels.length === 0) {
    return <p className="text-sm text-muted-foreground">No federation providers available.</p>
  }

  const defaultTab = panels[0]?.tabValue ?? 'overview'

  return (
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className="mb-4 flex w-full flex-wrap justify-start gap-1">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        {panels.map((panel) => (
          <TabsTrigger key={panel.tabValue} value={panel.tabValue}>
            {panel.tabLabel}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview">
        <div className="grid gap-4 lg:grid-cols-2">
          {panels.map((panel) => (
            <FederationTabPanel key={panel.tabValue} panel={panel} />
          ))}
        </div>
      </TabsContent>

      {panels.map((panel) => (
        <TabsContent key={panel.tabValue} value={panel.tabValue}>
          <FederationTabPanel panel={panel} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

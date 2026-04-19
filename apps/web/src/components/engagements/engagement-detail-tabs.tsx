'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EngagementArtifactsPanel } from './engagement-artifacts-panel'
import { EngagementInfoForm } from './engagement-info-form'
import { EngagementTimeline } from './engagement-timeline'

interface EngagementDetailTabsProps {
  engagement: {
    id: string
    projectName: string
    description: string | null
    status: string
    ownerId: string | null
  }
}

export function EngagementDetailTabs({ engagement }: EngagementDetailTabsProps) {
  return (
    <Tabs defaultValue="timeline" className="w-full">
      <TabsList>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        <TabsTrigger value="info">Info</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline" className="mt-4">
        <div className="rounded-lg border bg-card p-6">
          <EngagementTimeline engagementId={engagement.id} />
        </div>
      </TabsContent>
      <TabsContent value="artifacts" className="mt-4">
        <div className="rounded-lg border bg-card p-6">
          <EngagementArtifactsPanel engagementId={engagement.id} />
        </div>
      </TabsContent>
      <TabsContent value="info" className="mt-4">
        <div className="rounded-lg border bg-card p-6">
          <EngagementInfoForm engagement={engagement} />
        </div>
      </TabsContent>
    </Tabs>
  )
}

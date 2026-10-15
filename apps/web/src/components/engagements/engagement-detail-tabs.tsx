'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EngagementArtifactsPanel } from './engagement-artifacts-panel'
import { EngagementBlockedEventsPanel } from './engagement-blocked-events-panel'
import { EngagementContactsPanel } from './engagement-contacts-panel'
import { EngagementInfoForm } from './engagement-info-form'
import { EngagementItemsPanel } from './engagement-items-panel'
import { EngagementTimeline } from './engagement-timeline'
import { EngagementPaymentsPanel } from './payments/engagement-payments-panel'

interface EngagementDetailTabsProps {
  engagement: {
    id: string
    contactId: string
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
        <TabsTrigger value="items">Items</TabsTrigger>
        <TabsTrigger value="payments">Pagos</TabsTrigger>
        <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        <TabsTrigger value="contacts">Contacts</TabsTrigger>
        <TabsTrigger value="info">Info</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline" className="mt-4 space-y-4">
        <EngagementBlockedEventsPanel engagementId={engagement.id} />
        <div className="rounded-lg border bg-card p-6">
          <EngagementTimeline engagementId={engagement.id} />
        </div>
      </TabsContent>
      <TabsContent value="items" className="mt-4">
        <div className="rounded-lg border bg-card p-6">
          <EngagementItemsPanel engagementId={engagement.id} />
        </div>
      </TabsContent>
      <TabsContent value="payments" className="mt-4">
        <div className="rounded-lg border bg-card p-6">
          <EngagementPaymentsPanel contactId={engagement.contactId} engagementId={engagement.id} />
        </div>
      </TabsContent>
      <TabsContent value="contacts" className="mt-4">
        <div className="rounded-lg border bg-card p-6">
          <EngagementContactsPanel
            engagementId={engagement.id}
            primaryContactId={engagement.contactId}
          />
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

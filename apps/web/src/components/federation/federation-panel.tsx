import type { FederationProviderName } from '@phyne/types/crm'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface FederationPanelProps {
  provider: FederationProviderName
  contactId: string
  title: string
}

const providerLabels: Record<FederationProviderName, string> = {
  janua: 'Janua Identity',
  dhanam: 'Dhanam Billing',
  cotiza: 'Cotiza Manufacturing',
  forj: 'Forj Digital Assets',
}

export function FederationPanel({ provider, contactId, title }: FederationPanelProps) {
  // In production, this would use tRPC to fetch federated data
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Badge variant="outline">{providerLabels[provider]}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Federation data from {providerLabels[provider]} for contact {contactId}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Connect to view live data
        </p>
      </CardContent>
    </Card>
  )
}

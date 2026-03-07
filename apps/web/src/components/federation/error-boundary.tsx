'use client'

import { Component, type ReactNode } from 'react'
import type { FederationProviderName } from '@phyne/types/crm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Props {
  provider: FederationProviderName
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class FederationErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{this.props.provider}</CardTitle>
            <Badge variant="error">Unavailable</Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Unable to load data from {this.props.provider}
            </p>
            <p className="mt-1 text-xs text-destructive">
              {this.state.error?.message}
            </p>
          </CardContent>
        </Card>
      )
    }

    return this.props.children
  }
}

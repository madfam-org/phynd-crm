'use client'

import { trpc } from '@/lib/trpc/client'

export function useFederationHealth() {
  return trpc.federationHealth.status.useQuery(undefined, {
    refetchInterval: 30000, // Poll health every 30s
  })
}

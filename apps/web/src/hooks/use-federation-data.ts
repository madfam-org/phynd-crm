'use client'

import { trpc } from '@/lib/trpc/client'

export function useFederationHealth() {
  const federationHealthRouter = trpc.federationHealth as NonNullable<typeof trpc.federationHealth>
  const status = federationHealthRouter.status as NonNullable<typeof federationHealthRouter.status>
  return status.useQuery(undefined, {
    refetchInterval: 30000, // Poll health every 30s
  })
}

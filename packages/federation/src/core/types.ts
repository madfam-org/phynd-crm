import type { FederationProviderName, ProviderStatus } from '@phyne/types/federation'

export interface FederationProvider<TRaw, TMapped> {
  readonly name: FederationProviderName
  fetch(externalId: string, token: string, signal?: AbortSignal): Promise<TRaw>
  map(raw: TRaw): TMapped
  getCacheKey(externalId: string, tenantId: string): string
}

export interface FederationCallResult<T> {
  data: T | null
  status: ProviderStatus
  cachedAt: Date | null
  error: string | null
}

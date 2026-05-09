import type { FederationProviderName, ProviderStatus } from '@phynd/types/federation'

export interface FederationProvider<TRaw, TMapped> {
  readonly name: FederationProviderName
  fetch(externalId: string, token: string, signal?: AbortSignal): Promise<TRaw>
  map(raw: TRaw): TMapped
  getCacheKey(externalId: string, tenantId: string): string
  mutate?(
    externalId: string,
    payload: unknown,
    token: string,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<void>
}

export interface FederationCallResult<T> {
  data: T | null
  status: ProviderStatus
  cachedAt: Date | null
  error: string | null
}

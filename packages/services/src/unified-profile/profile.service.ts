import { isFeatureEnabled } from '@phynd/config/features'
import type { FederationCallResult, FederationClient } from '@phynd/federation'
import type {
  CotizaManufacturing,
  DhanamBilling,
  FederationProviderName,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
  ProviderStatus,
} from '@phynd/types/federation'
import { ContactsService } from '../contacts/contacts.service'
import type { ServiceContext } from '../context'
import { NotFoundError } from '../errors'
import { getDemoFederationData } from './demo-federation-data'
import { tryGetMockFederationData } from './mock-federation-registry'

interface ProfileDeps {
  januaClient: FederationClient<unknown, JanuaIdentity>
  dhanamClient: FederationClient<unknown, DhanamBilling>
  cotizaClient: FederationClient<unknown, CotizaManufacturing>
  pravaraClient: FederationClient<unknown, PravaraFabrication>
  forjClient: FederationClient<unknown, ForjAssets>
  januaTelemetryClient: FederationClient<unknown, JanuaTelemetry>
}

export class UnifiedProfileService {
  private readonly ctx: ServiceContext
  private readonly contactsService: ContactsService
  private readonly deps: ProfileDeps

  constructor(ctx: ServiceContext, deps: ProfileDeps) {
    this.ctx = ctx
    this.contactsService = new ContactsService(ctx)
    this.deps = deps
  }

  async getProfile(contactId: string, token: string) {
    const contact = await this.contactsService.getById(contactId)
    if (!contact) {
      throw new NotFoundError('Contact', contactId)
    }

    // Demo mode: return mock federation data (providers are unreachable)
    if (this.ctx.tenantId.startsWith('demo-')) {
      return getDemoFederationData(contact)
    }

    const externalId = contact.externalJanuaId ?? contactId

    // Promise.allSettled - partial provider failures don't block the page
    const unavailableResult = Promise.resolve({
      data: null,
      status: 'unavailable' as const,
      cachedAt: null,
      error: null,
    })

    const [
      identityResult,
      billingResult,
      mfgResult,
      fabricationResult,
      assetsResult,
      telemetryResult,
    ] = await Promise.allSettled([
      this.deps.januaClient.fetch(externalId, token),
      this.deps.dhanamClient.fetch(externalId, token),
      this.deps.cotizaClient.fetch(externalId, token),
      this.deps.pravaraClient.fetch(externalId, token),
      isFeatureEnabled('forjEnabled')
        ? this.deps.forjClient.fetch(externalId, token)
        : unavailableResult,
      isFeatureEnabled('visitorTracking')
        ? this.deps.januaTelemetryClient.fetch(externalId, token)
        : unavailableResult,
    ])

    const identity = this.unwrapResult<JanuaIdentity>(identityResult, 'janua')
    const billing = this.unwrapResult<DhanamBilling>(billingResult, 'dhanam')
    const manufacturing = this.unwrapResult<CotizaManufacturing>(mfgResult, 'cotiza')
    const fabrication = this.unwrapResult<PravaraFabrication>(fabricationResult, 'pravara')
    const assets = isFeatureEnabled('forjEnabled')
      ? this.unwrapResult<ForjAssets>(assetsResult, 'forj')
      : null
    const telemetry = isFeatureEnabled('visitorTracking')
      ? this.unwrapResult<JanuaTelemetry>(telemetryResult, 'janua-telemetry')
      : null

    const federationStatus: Record<FederationProviderName, ProviderStatus> = {
      janua: identity.status,
      dhanam: billing.status,
      cotiza: manufacturing.status,
      pravara: fabrication.status,
      forj: assets?.status ?? 'unavailable',
      tezca: 'ok', // Tezca is queried on-demand by RedditBotService, not per-profile
      'janua-telemetry': telemetry?.status ?? 'unavailable',
    }

    // Fallback: if all providers are unavailable and we have mock data, use it
    // This makes federation tabs work in local dev without running external services
    const allUnavailable =
      identity.status === 'unavailable' &&
      billing.status === 'unavailable' &&
      manufacturing.status === 'unavailable' &&
      fabrication.status === 'unavailable'
    if (allUnavailable && contact.externalJanuaId) {
      const mockData = tryGetMockFederationData(contact)
      if (mockData) return mockData
    }

    return {
      contact,
      identity,
      billing,
      manufacturing,
      fabrication,
      assets,
      telemetry,
      federationStatus,
    }
  }

  private unwrapResult<T>(
    result: PromiseSettledResult<FederationCallResult<T>>,
    provider: FederationProviderName,
  ): {
    data: T | null
    status: ProviderStatus
    cachedAt: Date | null
    error: string | null
    provider: FederationProviderName
  } {
    if (result.status === 'fulfilled') {
      return { ...result.value, provider }
    }
    return {
      data: null,
      status: 'unavailable',
      cachedAt: null,
      error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
      provider,
    }
  }
}

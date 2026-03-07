import { isFeatureEnabled } from '@phyne/config/features'
import type { FederationCallResult, FederationClient } from '@phyne/federation'
import type {
  CotizaManufacturing,
  DhanamBilling,
  FederationProviderName,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
  ProviderStatus,
} from '@phyne/types/federation'
import { ContactsService } from '../contacts/contacts.service'
import type { ServiceContext } from '../context'

interface ProfileDeps {
  januaClient: FederationClient<unknown, JanuaIdentity>
  dhanamClient: FederationClient<unknown, DhanamBilling>
  cotizaClient: FederationClient<unknown, CotizaManufacturing>
  pravaraClient: FederationClient<unknown, PravaraFabrication>
  forjClient: FederationClient<unknown, ForjAssets>
  januaTelemetryClient: FederationClient<unknown, JanuaTelemetry>
}

export class UnifiedProfileService {
  private readonly contactsService: ContactsService
  private readonly deps: ProfileDeps

  constructor(ctx: ServiceContext, deps: ProfileDeps) {
    this.contactsService = new ContactsService(ctx)
    this.deps = deps
  }

  async getProfile(contactId: string, token: string) {
    const contact = await this.contactsService.getById(contactId)
    if (!contact) {
      throw new Error(`Contact not found: ${contactId}`)
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
      'janua-telemetry': telemetry?.status ?? 'unavailable',
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

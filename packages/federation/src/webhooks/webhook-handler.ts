import type { FederationProviderName } from '@phynd/types'
import type { CacheInvalidator } from './cache-invalidator'
import { validateWebhookSignature } from './webhook-validator'

interface WebhookResult {
  success: boolean
  eventType: string
  cacheInvalidated: boolean
}

export class WebhookHandler {
  private readonly cacheInvalidator: CacheInvalidator

  constructor(cacheInvalidator: CacheInvalidator) {
    this.cacheInvalidator = cacheInvalidator
  }

  async handle(
    provider: FederationProviderName,
    rawBody: string,
    signature: string,
    secret: string,
  ): Promise<WebhookResult> {
    // 1. Validate signature
    if (!validateWebhookSignature(rawBody, signature, secret)) {
      throw new Error('Invalid webhook signature')
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>
    const eventType = (payload.type ?? payload.event ?? 'unknown') as string

    // 2. Invalidate cache
    const cacheInvalidated = await this.cacheInvalidator.invalidate(provider, eventType, payload)

    return { success: true, eventType, cacheInvalidated }
  }
}

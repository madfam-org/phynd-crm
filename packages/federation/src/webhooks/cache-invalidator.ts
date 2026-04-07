import type { FederationProviderName } from '@phyne/types'
import type { CacheManager } from '../core/cache-manager'

interface InvalidationRule {
  cachePrefix: string
  extractId: (payload: Record<string, unknown>) => string | null
}

const INVALIDATION_RULES: Record<FederationProviderName, Record<string, InvalidationRule>> = {
  janua: {
    'user.updated': {
      cachePrefix: 'fed:janua',
      extractId: (p) => (p.user_id as string) ?? null,
    },
    'user.deleted': {
      cachePrefix: 'fed:janua',
      extractId: (p) => (p.user_id as string) ?? null,
    },
  },
  dhanam: {
    'subscription.updated': {
      cachePrefix: 'fed:dhanam',
      extractId: (p) => (p.customer_id as string) ?? null,
    },
    'invoice.paid': {
      cachePrefix: 'fed:dhanam',
      extractId: (p) => (p.customer_id as string) ?? null,
    },
    'payment.completed': {
      cachePrefix: 'fed:dhanam',
      extractId: (p) => (p.customer_id as string) ?? null,
    },
  },
  cotiza: {
    'order.updated': {
      cachePrefix: 'fed:cotiza',
      extractId: (p) => (p.client_id as string) ?? null,
    },
    'order.completed': {
      cachePrefix: 'fed:cotiza',
      extractId: (p) => (p.client_id as string) ?? null,
    },
  },
  pravara: {
    'order.status_changed': {
      cachePrefix: 'fed:pravara',
      extractId: (p) => (p.contact_id as string) ?? null,
    },
    'order.created': {
      cachePrefix: 'fed:pravara',
      extractId: (p) => (p.contact_id as string) ?? null,
    },
    'order.completed': {
      cachePrefix: 'fed:pravara',
      extractId: (p) => (p.contact_id as string) ?? null,
    },
  },
  forj: {
    'asset.processed': {
      cachePrefix: 'fed:forj',
      extractId: (p) => (p.owner_id as string) ?? null,
    },
    'asset.updated': {
      cachePrefix: 'fed:forj',
      extractId: (p) => (p.owner_id as string) ?? null,
    },
  },
  tezca: {
    'interest.created': {
      cachePrefix: 'fed:tezca',
      extractId: (p) => {
        const data = p.data as Record<string, unknown> | undefined
        const target = data?.outreach_target as Record<string, unknown> | undefined
        return (target?.author as string) ?? null
      },
    },
  },
  'janua-telemetry': {
    'session.identified': {
      cachePrefix: 'fed:janua-telemetry',
      extractId: (p) => (p.contact_id as string) ?? null,
    },
    'session.ended': {
      cachePrefix: 'fed:janua-telemetry',
      extractId: (p) => (p.contact_id as string) ?? null,
    },
  },
}

export class CacheInvalidator {
  constructor(private readonly cacheManager: CacheManager) {}

  async invalidate(
    provider: FederationProviderName,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const providerRules = INVALIDATION_RULES[provider]
    const rule = providerRules?.[eventType]

    if (!rule) return false

    const id = rule.extractId(payload)
    if (!id) return false

    await this.cacheManager.invalidate(rule.cachePrefix, id)
    return true
  }
}

import type {
  CotizaManufacturing,
  DhanamBilling,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
  ProviderStatus,
} from '@phyne/types/federation'
import { getTablacoFederationData } from './tablaco-federation-data'

type FederationEntry<T> = {
  data: T
  status: ProviderStatus
  cachedAt: Date
  error: null
  provider: string
}

function entry<T>(data: T, provider: string): FederationEntry<T> {
  return { data, status: 'ok', cachedAt: new Date(), error: null, provider }
}

export function getDemoFederationData<
  C extends { id: string; name: string; email: string | null; externalJanuaId: string | null },
>(contact: C) {
  if (contact.externalJanuaId === 'janua-tablaco-001') {
    return getTablacoFederationData(contact)
  }

  const now = new Date()
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const inTwoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  const inOneMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const identity: JanuaIdentity = {
    userId: contact.externalJanuaId ?? contact.id,
    email: contact.email ?? `${contact.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    displayName: contact.name,
    avatarUrl: null,
    roles: ['customer'],
    scopes: ['read:profile', 'read:orders'],
    verified: true,
    lastLoginAt: twoDaysAgo,
  }

  const billing: DhanamBilling = {
    customerId: `dhn_${contact.id.slice(0, 8)}`,
    plan: 'Enterprise',
    status: 'active',
    currentBalance: 0,
    currency: 'USD',
    invoices: [
      {
        id: `inv_001_${contact.id.slice(0, 6)}`,
        amount: 2400,
        currency: 'USD',
        status: 'paid',
        issuedAt: oneMonthAgo,
        paidAt: twoWeeksAgo,
      },
      {
        id: `inv_002_${contact.id.slice(0, 6)}`,
        amount: 2400,
        currency: 'USD',
        status: 'paid',
        issuedAt: twoWeeksAgo,
        paidAt: oneWeekAgo,
      },
    ],
    paymentMethods: [
      {
        id: `pm_${contact.id.slice(0, 8)}`,
        type: 'card',
        last4: '4242',
        isDefault: true,
      },
    ],
  }

  const manufacturing: CotizaManufacturing = {
    orders: [
      {
        id: `ctz_ord_${contact.id.slice(0, 6)}`,
        status: 'in_progress',
        productName: 'Custom Display Unit',
        quantity: 50,
        estimatedCompletion: inTwoWeeks,
        progress: 65,
        createdAt: twoWeeksAgo,
      },
    ],
    activeQuotes: [
      {
        id: `ctz_qt_${contact.id.slice(0, 6)}`,
        status: 'pending',
        totalAmount: 18500,
        currency: 'USD',
        validUntil: inOneMonth,
        createdAt: oneWeekAgo,
      },
    ],
  }

  const fabrication: PravaraFabrication = {
    orders: [
      {
        orderId: `prv_001_${contact.id.slice(0, 6)}`,
        cotizaOrderId: `ctz_ord_${contact.id.slice(0, 6)}`,
        status: 'in_progress',
        productName: 'Custom Display Unit',
        quantity: 50,
        startedAt: oneWeekAgo.toISOString(),
        estimatedCompletion: inTwoWeeks.toISOString(),
        currentStep: 'Assembly',
        totalSteps: 5,
        completedSteps: 3,
      },
      {
        orderId: `prv_002_${contact.id.slice(0, 6)}`,
        status: 'completed',
        productName: 'Branded Packaging',
        quantity: 200,
        startedAt: oneMonthAgo.toISOString(),
        estimatedCompletion: twoWeeksAgo.toISOString(),
        completedAt: oneWeekAgo.toISOString(),
        currentStep: 'Shipping',
        totalSteps: 4,
        completedSteps: 4,
      },
    ],
    summary: {
      total: 2,
      inProgress: 1,
      completed: 1,
      delayed: 0,
    },
  }

  const assets: ForjAssets = {
    assets: [
      {
        id: `forj_3d_${contact.id.slice(0, 6)}`,
        name: 'Product Showcase Model',
        type: 'model_3d',
        thumbnailUrl: null,
        modelUrl: `forj://asset/forj_3d_${contact.id.slice(0, 6)}/view`,
        format: 'glTF',
        nftCertificateUrl: null,
        createdAt: twoWeeksAgo,
        updatedAt: oneWeekAgo,
      },
      {
        id: `forj_tex_${contact.id.slice(0, 6)}`,
        name: 'Brand Texture Pack',
        type: 'texture',
        thumbnailUrl: null,
        modelUrl: null,
        format: 'PNG',
        nftCertificateUrl: null,
        createdAt: oneMonthAgo,
        updatedAt: twoWeeksAgo,
      },
    ],
    totalCount: 2,
  }

  const telemetry: JanuaTelemetry = {
    sessions: [
      {
        sessionId: `sess_demo_1_${contact.id.slice(0, 6)}`,
        fingerprint: 'fp_demo_abc123',
        contactId: contact.id,
        identified: true,
        ipCity: 'San Francisco',
        ipCountry: 'US',
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'macOS',
        referrer: 'https://www.google.com',
        utm: { source: 'google', medium: 'organic', campaign: null, term: null, content: null },
        pageViews: [
          {
            url: '/products',
            title: 'Products',
            duration: 45,
            timestamp: twoDaysAgo.toISOString(),
          },
          { url: '/pricing', title: 'Pricing', duration: 30, timestamp: twoDaysAgo.toISOString() },
        ],
        startedAt: twoDaysAgo.toISOString(),
        endedAt: twoDaysAgo.toISOString(),
        duration: 120,
      },
      {
        sessionId: `sess_demo_2_${contact.id.slice(0, 6)}`,
        fingerprint: 'fp_demo_abc123',
        contactId: contact.id,
        identified: true,
        ipCity: 'San Francisco',
        ipCountry: 'US',
        deviceType: 'mobile',
        browser: 'Safari',
        os: 'iOS',
        referrer: null,
        utm: {
          source: 'email',
          medium: 'newsletter',
          campaign: 'spring-2026',
          term: null,
          content: null,
        },
        pageViews: [
          {
            url: '/products/custom-display',
            title: 'Custom Display Unit',
            duration: 60,
            timestamp: oneWeekAgo.toISOString(),
          },
        ],
        startedAt: oneWeekAgo.toISOString(),
        endedAt: oneWeekAgo.toISOString(),
        duration: 85,
      },
    ],
    totalSessions: 2,
    uniqueDevices: 2,
    topSources: [
      { source: 'google', count: 1 },
      { source: 'email', count: 1 },
    ],
  }

  return {
    contact,
    identity: entry(identity, 'janua'),
    billing: entry(billing, 'dhanam'),
    manufacturing: entry(manufacturing, 'cotiza'),
    fabrication: entry(fabrication, 'pravara'),
    assets: entry(assets, 'forj'),
    telemetry: entry(telemetry, 'janua-telemetry'),
    federationStatus: {
      janua: 'ok' as const,
      dhanam: 'ok' as const,
      cotiza: 'ok' as const,
      pravara: 'ok' as const,
      forj: 'ok' as const,
      'janua-telemetry': 'ok' as const,
    },
  }
}

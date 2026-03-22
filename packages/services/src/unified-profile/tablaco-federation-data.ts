import type {
  CotizaManufacturing,
  DhanamBilling,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
  ProviderStatus,
} from '@phyne/types/federation'

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

export function getTablacoFederationData<
  C extends { id: string; name: string; email: string | null; externalJanuaId: string | null },
>(contact: C) {
  const now = new Date()
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000)

  const identity: JanuaIdentity = {
    userId: 'janua-tablaco-001',
    email: 'rodrigo@tablaco.mx',
    displayName: 'Rodrigo Tablaco',
    avatarUrl: null,
    roles: ['customer', 'project_client'],
    scopes: ['read:profile', 'read:orders', 'read:assets'],
    verified: true,
    lastLoginAt: daysAgo(3),
  }

  const billing: DhanamBilling = {
    customerId: 'dhanam-tablaco-001',
    plan: 'Project',
    status: 'active',
    currentBalance: 15000,
    currency: 'USD',
    invoices: [
      {
        id: 'inv-tab-001',
        amount: 15000,
        currency: 'USD',
        status: 'paid',
        issuedAt: daysAgo(58),
        paidAt: daysAgo(55),
      },
      {
        id: 'inv-tab-002',
        amount: 15000,
        currency: 'USD',
        status: 'paid',
        issuedAt: daysAgo(38),
        paidAt: daysAgo(35),
      },
      {
        id: 'inv-tab-003',
        amount: 15000,
        currency: 'USD',
        status: 'pending',
        issuedAt: daysAgo(8),
        paidAt: null,
      },
    ],
    paymentMethods: [
      {
        id: 'pm-tab-001',
        type: 'bank_transfer',
        last4: '7890',
        isDefault: true,
      },
    ],
  }

  const manufacturing: CotizaManufacturing = {
    orders: [
      {
        id: 'cotiza-tab-ord-001',
        status: 'in_progress',
        productName: 'Tablaco Web Platform Phase 1+2',
        quantity: 1,
        estimatedCompletion: daysFromNow(7),
        progress: 85,
        createdAt: daysAgo(55),
      },
    ],
    activeQuotes: [
      {
        id: 'cotiza-tab-qt-001',
        status: 'accepted',
        totalAmount: 45000,
        currency: 'USD',
        validUntil: daysFromNow(30),
        createdAt: daysAgo(60),
      },
    ],
  }

  const fabrication: PravaraFabrication = {
    orders: [
      {
        orderId: 'pravara-tab-001',
        cotizaOrderId: 'cotiza-tab-ord-001',
        status: 'in_progress',
        productName: 'Tablaco Phase 1',
        quantity: 1,
        startedAt: daysAgo(48).toISOString(),
        estimatedCompletion: daysFromNow(7).toISOString(),
        currentStep: 'QA & Delivery',
        totalSteps: 6,
        completedSteps: 5,
      },
    ],
    summary: {
      total: 1,
      inProgress: 1,
      completed: 0,
      delayed: 0,
    },
  }

  const assets: ForjAssets = {
    assets: [
      {
        id: 'forj-tablaco-3d-001',
        name: 'Tablaco 3D Product Viewer',
        type: 'model_3d',
        thumbnailUrl: null,
        modelUrl: 'forj://asset/forj-tablaco-3d-001/view',
        format: 'glTF',
        nftCertificateUrl: null,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(12),
      },
      {
        id: 'forj-tablaco-scene-001',
        name: 'yantra4d.com/tablaco Web Deployment',
        type: 'scene',
        thumbnailUrl: null,
        modelUrl: 'forj://scene/forj-tablaco-scene-001/view',
        format: 'glTF',
        nftCertificateUrl: null,
        createdAt: daysAgo(15),
        updatedAt: daysAgo(10),
      },
    ],
    totalCount: 2,
  }

  const telemetry: JanuaTelemetry = {
    sessions: [
      {
        sessionId: 'sess-tablaco-001',
        fingerprint: 'fp-tablaco-desktop',
        contactId: contact.id,
        identified: true,
        ipCity: 'Mexico City',
        ipCountry: 'MX',
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'macOS',
        referrer: null,
        utm: { source: 'direct', medium: null, campaign: null, term: null, content: null },
        pageViews: [
          {
            url: '/tablaco',
            title: 'Tablaco — yantra4d',
            duration: 35,
            timestamp: daysAgo(20).toISOString(),
          },
          {
            url: '/tablaco/gallery',
            title: 'Tablaco Gallery — yantra4d',
            duration: 55,
            timestamp: daysAgo(20).toISOString(),
          },
          {
            url: 'forj://asset/forj-tablaco-3d-001/view',
            title: 'Tablaco 3D Product Viewer',
            duration: 42,
            timestamp: daysAgo(20).toISOString(),
          },
        ],
        startedAt: daysAgo(20).toISOString(),
        endedAt: daysAgo(20).toISOString(),
        duration: 180,
      },
      {
        sessionId: 'sess-tablaco-002',
        fingerprint: 'fp-tablaco-mobile',
        contactId: contact.id,
        identified: true,
        ipCity: 'Mexico City',
        ipCountry: 'MX',
        deviceType: 'mobile',
        browser: 'Safari',
        os: 'iOS',
        referrer: null,
        utm: {
          source: 'email',
          medium: 'notification',
          campaign: null,
          term: null,
          content: null,
        },
        pageViews: [
          {
            url: '/tablaco',
            title: 'Tablaco — yantra4d',
            duration: 18,
            timestamp: daysAgo(8).toISOString(),
          },
        ],
        startedAt: daysAgo(8).toISOString(),
        endedAt: daysAgo(8).toISOString(),
        duration: 45,
      },
    ],
    totalSessions: 2,
    uniqueDevices: 2,
    topSources: [
      { source: 'direct', count: 1 },
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

import type {
  CotizaManufacturing,
  DhanamBilling,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
  ProviderStatus,
} from '@phynd/types/federation'

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

export function getProjectClientFederationData<
  C extends { id: string; name: string; email: string | null; externalJanuaId: string | null },
>(contact: C) {
  const now = new Date()
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000)

  const identity: JanuaIdentity = {
    userId: 'janua-demo-project-001',
    email: 'mateo@acme-fabricacion.example',
    displayName: 'Mateo Ríos',
    avatarUrl: null,
    roles: ['customer', 'project_client'],
    scopes: ['read:profile', 'read:orders', 'read:assets'],
    verified: true,
    lastLoginAt: daysAgo(3),
  }

  const billing: DhanamBilling = {
    customerId: 'dhanam-demo-project-001',
    plan: 'Project',
    status: 'active',
    currentBalance: 4800,
    currency: 'USD',
    invoices: [
      {
        id: 'inv-prj-001',
        amount: 4800,
        currency: 'USD',
        status: 'paid',
        issuedAt: daysAgo(58),
        paidAt: daysAgo(55),
      },
      {
        id: 'inv-prj-002',
        amount: 4800,
        currency: 'USD',
        status: 'paid',
        issuedAt: daysAgo(38),
        paidAt: daysAgo(35),
      },
      {
        id: 'inv-prj-003',
        amount: 4800,
        currency: 'USD',
        status: 'pending',
        issuedAt: daysAgo(8),
        paidAt: null,
      },
    ],
    paymentMethods: [
      {
        id: 'pm-prj-001',
        type: 'bank_transfer',
        last4: '7890',
        isDefault: true,
      },
    ],
  }

  const manufacturing: CotizaManufacturing = {
    orders: [
      {
        id: 'cotiza-prj-ord-001',
        status: 'in_progress',
        productName: 'Product Configurator, Phases 1+2',
        quantity: 1,
        estimatedCompletion: daysFromNow(7),
        progress: 85,
        createdAt: daysAgo(55),
      },
    ],
    activeQuotes: [
      {
        id: 'cotiza-prj-qt-001',
        status: 'accepted',
        totalAmount: 14400,
        currency: 'USD',
        validUntil: daysFromNow(30),
        createdAt: daysAgo(60),
      },
    ],
  }

  const fabrication: PravaraFabrication = {
    orders: [
      {
        orderId: 'pravara-prj-001',
        cotizaOrderId: 'cotiza-prj-ord-001',
        status: 'in_progress',
        productName: 'Product Configurator, Phase 1',
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
        id: 'forj-demo-3d-001',
        name: '3D Product Viewer',
        type: 'model_3d',
        thumbnailUrl: null,
        modelUrl: 'forj://asset/forj-demo-3d-001/view',
        format: 'glTF',
        nftCertificateUrl: null,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(12),
      },
      {
        id: 'forj-demo-scene-001',
        name: 'Product Configurator Web Deployment',
        type: 'scene',
        thumbnailUrl: null,
        modelUrl: 'forj://scene/forj-demo-scene-001/view',
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
        sessionId: 'sess-demo-001',
        fingerprint: 'fp-demo-desktop',
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
            url: '/acme-demo',
            title: 'Acme Fabricación — yantra4d',
            duration: 35,
            timestamp: daysAgo(20).toISOString(),
          },
          {
            url: '/acme-demo/gallery',
            title: 'Acme Fabricación Gallery — yantra4d',
            duration: 55,
            timestamp: daysAgo(20).toISOString(),
          },
          {
            url: 'forj://asset/forj-demo-3d-001/view',
            title: '3D Product Viewer',
            duration: 42,
            timestamp: daysAgo(20).toISOString(),
          },
        ],
        startedAt: daysAgo(20).toISOString(),
        endedAt: daysAgo(20).toISOString(),
        duration: 180,
      },
      {
        sessionId: 'sess-demo-002',
        fingerprint: 'fp-demo-mobile',
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
            url: '/acme-demo',
            title: 'Acme Fabricación — yantra4d',
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
      tezca: 'unavailable' as const,
      'janua-telemetry': 'ok' as const,
    },
  }
}

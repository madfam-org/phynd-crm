import type { FederationProviderName } from './crm'
export type { FederationProviderName } from './crm'

export type ProviderStatus = 'ok' | 'degraded' | 'unavailable'

export interface FederationResponse<T> {
  data: T | null
  status: ProviderStatus
  provider: FederationProviderName
  cachedAt: Date | null
  error: string | null
}

export interface FederationHealthStatus {
  provider: FederationProviderName
  status: ProviderStatus
  latencyMs: number | null
  lastChecked: Date
  circuitState: CircuitState
}

export type CircuitState = 'closed' | 'open' | 'half_open'

export interface CircuitBreakerConfig {
  failureThreshold: number
  resetTimeoutMs: number
  halfOpenSuccessThreshold: number
}

export interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  jitterFactor: number
}

export interface CacheConfig {
  ttlSeconds: number
  keyPrefix: string
}

export interface ProviderConfig {
  name: FederationProviderName
  baseUrl: string
  timeout: number
  cache: CacheConfig
  retry: RetryConfig
  circuitBreaker: CircuitBreakerConfig
}

// Provider-specific data shapes

export interface JanuaIdentity {
  userId: string
  email: string
  displayName: string
  avatarUrl: string | null
  roles: string[]
  scopes: string[]
  verified: boolean
  lastLoginAt: Date | null
}

export interface DhanamBilling {
  customerId: string
  plan: string
  status: string
  currentBalance: number
  currency: string
  invoices: DhanamInvoice[]
  paymentMethods: DhanamPaymentMethod[]
}

export interface DhanamInvoice {
  id: string
  amount: number
  currency: string
  status: string
  issuedAt: Date
  paidAt: Date | null
}

export interface DhanamPaymentMethod {
  id: string
  type: string
  last4: string
  isDefault: boolean
}

export interface CotizaManufacturing {
  orders: CotizaOrder[]
  activeQuotes: CotizaQuote[]
}

export interface CotizaOrder {
  id: string
  status: string
  productName: string
  quantity: number
  estimatedCompletion: Date | null
  progress: number
  createdAt: Date
}

export interface CotizaQuote {
  id: string
  status: string
  totalAmount: number
  currency: string
  validUntil: Date
  createdAt: Date
}

export interface ForjAssets {
  assets: ForjAsset[]
  totalCount: number
}

export interface ForjAsset {
  id: string
  name: string
  type: ForjAssetType
  thumbnailUrl: string | null
  modelUrl: string | null
  format: string | null
  nftCertificateUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export type ForjAssetType = 'model_3d' | 'texture' | 'material' | 'scene'

// PravaraMES -- Fabrication Order Status
export interface PravaraFabrication {
  orders: PravaraOrder[]
  summary: { total: number; inProgress: number; completed: number; delayed: number }
}

export interface PravaraOrder {
  orderId: string
  cotizaOrderId?: string
  status: PravaraOrderStatus
  productName: string
  quantity: number
  startedAt: string
  estimatedCompletion: string
  completedAt?: string
  currentStep: string
  totalSteps: number
  completedSteps: number
  notes?: string
}

export type PravaraOrderStatus = 'queued' | 'in_progress' | 'quality_check' | 'completed' | 'delayed' | 'cancelled'

// Unified Profile (SPOG)
export interface UnifiedProfile {
  contact: import('./crm.js').Contact
  identity: FederationResponse<JanuaIdentity>
  billing: FederationResponse<DhanamBilling>
  manufacturing: FederationResponse<CotizaManufacturing>
  fabrication: FederationResponse<PravaraFabrication>
  assets?: FederationResponse<ForjAssets> | null
  federationStatus: Record<FederationProviderName, ProviderStatus>
}

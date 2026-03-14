export interface FeatureFlags {
  /** Phase 1: Read-only federation */
  federationReadOnly: boolean
  /** Phase 2: Bidirectional sync with external systems */
  bidirectionalSync: boolean
  /** Phase 2: AI-powered lead scoring */
  leadScoring: boolean
  /** Phase 2: AI Kanban observability */
  aiKanban: boolean
  /** Phase 3: Multi-tenant SaaS */
  multiTenancy: boolean
  /** Phase 2: PII masking for LLM contexts */
  piiMasking: boolean
  /** Phase 2: OpenTelemetry tracing */
  observability: boolean
  /** Phase 2: WebSocket real-time updates from Cotiza */
  realtimeUpdates: boolean
  /** Forj digital assets provider */
  forjEnabled: boolean
  /** Anonymous visitor tracking via Janua telemetry */
  visitorTracking: boolean
  /** Funnel and offer management */
  funnelManagement: boolean
  /** Analytics dashboard */
  analytics: boolean
}

const defaults: FeatureFlags = {
  federationReadOnly: true,
  bidirectionalSync: false,
  leadScoring: true,
  aiKanban: false,
  multiTenancy: false,
  piiMasking: false,
  observability: false,
  realtimeUpdates: false,
  forjEnabled: true,
  visitorTracking: true,
  funnelManagement: true,
  analytics: true,
}

let flags: FeatureFlags = { ...defaults }

export function getFeatureFlags(): Readonly<FeatureFlags> {
  return Object.freeze({ ...flags })
}

export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return flags[flag]
}

export function setFeatureFlags(overrides: Partial<FeatureFlags>): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot modify feature flags in production')
  }
  flags = { ...flags, ...overrides }
}

export function resetFeatureFlags(): void {
  flags = { ...defaults }
}

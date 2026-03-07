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
  leadScoring: false,
  aiKanban: false,
  multiTenancy: false,
  piiMasking: false,
  observability: false,
  realtimeUpdates: false,
  forjEnabled: true,
  visitorTracking: false,
  funnelManagement: false,
  analytics: false,
}

let flags: FeatureFlags = { ...defaults }

export function getFeatureFlags(): Readonly<FeatureFlags> {
  return flags
}

export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return flags[flag]
}

export function setFeatureFlags(overrides: Partial<FeatureFlags>): void {
  flags = { ...flags, ...overrides }
}

export function resetFeatureFlags(): void {
  flags = { ...defaults }
}

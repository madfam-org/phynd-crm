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
  /** ACCA Treasury Hunter grant management */
  treasuryHunter: boolean
  /** Referral code management and tracking */
  referralManagement: boolean
}

const defaults: FeatureFlags = {
  federationReadOnly: false,
  bidirectionalSync: true,
  leadScoring: true,
  aiKanban: false,
  multiTenancy: true,
  piiMasking: false,
  observability: false,
  realtimeUpdates: false,
  forjEnabled: true,
  visitorTracking: true,
  funnelManagement: true,
  analytics: true,
  treasuryHunter: false,
  referralManagement: true,
}

/**
 * Production-only env toggles for gated features. Runtime `setFeatureFlags()` is
 * blocked in production; operators enable via env (e.g. FEATURE_TREASURY_HUNTER=true).
 */
const PRODUCTION_ENV_OVERRIDES: Partial<Record<keyof FeatureFlags, string>> = {
  treasuryHunter: 'FEATURE_TREASURY_HUNTER',
  observability: 'FEATURE_OBSERVABILITY',
  piiMasking: 'FEATURE_PII_MASKING',
  aiKanban: 'FEATURE_AI_KANBAN',
}

let flags: FeatureFlags = { ...defaults }

function parseEnvFlag(value: string | undefined): boolean | undefined {
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}

function resolveFlags(): FeatureFlags {
  const merged = { ...flags }
  if (process.env.NODE_ENV === 'production') {
    for (const [flag, envKey] of Object.entries(PRODUCTION_ENV_OVERRIDES)) {
      const parsed = parseEnvFlag(process.env[envKey])
      if (parsed !== undefined) {
        merged[flag as keyof FeatureFlags] = parsed
      }
    }
  }
  return merged
}

export function getFeatureFlags(): Readonly<FeatureFlags> {
  return Object.freeze(resolveFlags())
}

export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return resolveFlags()[flag]
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

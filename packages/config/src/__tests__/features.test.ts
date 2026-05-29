import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type FeatureFlags,
  getFeatureFlags,
  isFeatureEnabled,
  resetFeatureFlags,
  setFeatureFlags,
} from '../features'

// Reset to known state before every test to prevent cross-test pollution
beforeEach(() => {
  resetFeatureFlags()
})

describe('default feature flags (Phase 2/3)', () => {
  it('has federationReadOnly disabled by default', () => {
    const flags = getFeatureFlags()
    expect(flags.federationReadOnly).toBe(false)
  })

  it('has bidirectionalSync enabled by default', () => {
    expect(getFeatureFlags().bidirectionalSync).toBe(true)
  })

  it('has leadScoring enabled by default', () => {
    expect(getFeatureFlags().leadScoring).toBe(true)
  })

  it('has aiKanban disabled by default', () => {
    expect(getFeatureFlags().aiKanban).toBe(false)
  })

  it('has multiTenancy enabled by default', () => {
    expect(getFeatureFlags().multiTenancy).toBe(true)
  })

  it('has piiMasking disabled by default', () => {
    expect(getFeatureFlags().piiMasking).toBe(false)
  })

  it('has observability disabled by default', () => {
    expect(getFeatureFlags().observability).toBe(false)
  })

  it('has realtimeUpdates disabled by default', () => {
    expect(getFeatureFlags().realtimeUpdates).toBe(false)
  })

  it('has forjEnabled enabled by default', () => {
    expect(getFeatureFlags().forjEnabled).toBe(true)
  })

  it('has visitorTracking enabled by default', () => {
    expect(getFeatureFlags().visitorTracking).toBe(true)
  })

  it('has funnelManagement enabled by default', () => {
    expect(getFeatureFlags().funnelManagement).toBe(true)
  })

  it('has analytics enabled by default', () => {
    expect(getFeatureFlags().analytics).toBe(true)
  })

  it('has exactly 14 feature flags defined', () => {
    const flags = getFeatureFlags()
    expect(Object.keys(flags)).toHaveLength(14)
  })

  it('8 flags are true in defaults; 6 are false', () => {
    const flags = getFeatureFlags()
    const trueFlags = Object.entries(flags).filter(([, v]) => v === true)
    const falseFlags = Object.entries(flags).filter(([, v]) => v === false)

    expect(trueFlags).toHaveLength(8)
    expect(trueFlags.map(([k]) => k).sort()).toEqual([
      'analytics',
      'bidirectionalSync',
      'forjEnabled',
      'funnelManagement',
      'leadScoring',
      'multiTenancy',
      'referralManagement',
      'visitorTracking',
    ])
    expect(falseFlags).toHaveLength(6)
  })
})

describe('isFeatureEnabled', () => {
  it('returns false for federationReadOnly with default flags', () => {
    expect(isFeatureEnabled('federationReadOnly')).toBe(false)
  })

  it('returns true for forjEnabled with default flags', () => {
    expect(isFeatureEnabled('forjEnabled')).toBe(true)
  })

  it('returns true for enabled features with default flags', () => {
    const enabledFeatures: (keyof FeatureFlags)[] = [
      'visitorTracking',
      'funnelManagement',
      'analytics',
      'leadScoring',
      'bidirectionalSync',
      'multiTenancy',
    ]
    for (const flag of enabledFeatures) {
      expect(isFeatureEnabled(flag)).toBe(true)
    }
  })

  it('returns false for disabled features with default flags', () => {
    const disabled: (keyof FeatureFlags)[] = [
      'aiKanban',
      'piiMasking',
      'observability',
      'realtimeUpdates',
    ]
    for (const flag of disabled) {
      expect(isFeatureEnabled(flag)).toBe(false)
    }
  })

  it('reflects changes made by setFeatureFlags', () => {
    expect(isFeatureEnabled('aiKanban')).toBe(false)
    setFeatureFlags({ aiKanban: true })
    expect(isFeatureEnabled('aiKanban')).toBe(true)
  })

  it('reflects restored defaults after resetFeatureFlags', () => {
    setFeatureFlags({ aiKanban: true })
    expect(isFeatureEnabled('aiKanban')).toBe(true)

    resetFeatureFlags()
    expect(isFeatureEnabled('aiKanban')).toBe(false)
  })
})

describe('setFeatureFlags', () => {
  it('overrides a single flag while keeping others unchanged', () => {
    setFeatureFlags({ aiKanban: true })

    const flags = getFeatureFlags()
    expect(flags.aiKanban).toBe(true)
    // All other flags should remain at default values
    expect(flags.federationReadOnly).toBe(false)
    expect(flags.leadScoring).toBe(true)
    expect(flags.bidirectionalSync).toBe(true)
    expect(flags.multiTenancy).toBe(true)
    expect(flags.piiMasking).toBe(false)
    expect(flags.observability).toBe(false)
    expect(flags.realtimeUpdates).toBe(false)
    expect(flags.forjEnabled).toBe(true)
    expect(flags.visitorTracking).toBe(true)
    expect(flags.funnelManagement).toBe(true)
    expect(flags.analytics).toBe(true)
  })

  it('overrides multiple flags simultaneously', () => {
    setFeatureFlags({
      federationReadOnly: true,
      aiKanban: true,
      piiMasking: true,
    })

    const flags = getFeatureFlags()
    expect(flags.federationReadOnly).toBe(true)
    expect(flags.aiKanban).toBe(true)
    expect(flags.piiMasking).toBe(true)
    // Unset flags remain default
    expect(flags.bidirectionalSync).toBe(true)
    expect(flags.leadScoring).toBe(true)
  })

  it('can disable a flag that was previously enabled', () => {
    // bidirectionalSync is true by default
    setFeatureFlags({ bidirectionalSync: false })
    expect(getFeatureFlags().bidirectionalSync).toBe(false)
  })

  it('applies overrides cumulatively across multiple calls', () => {
    setFeatureFlags({ aiKanban: true })
    setFeatureFlags({ observability: true })

    const flags = getFeatureFlags()
    expect(flags.aiKanban).toBe(true)
    expect(flags.observability).toBe(true)
  })

  it('allows toggling a flag on and off', () => {
    setFeatureFlags({ aiKanban: true })
    expect(getFeatureFlags().aiKanban).toBe(true)

    setFeatureFlags({ aiKanban: false })
    expect(getFeatureFlags().aiKanban).toBe(false)
  })

  it('accepts an empty overrides object without changing anything', () => {
    const before = { ...getFeatureFlags() }
    setFeatureFlags({})
    const after = getFeatureFlags()

    expect(after).toEqual(before)
  })
})

describe('resetFeatureFlags', () => {
  it('restores all flags to their default values', () => {
    setFeatureFlags({
      federationReadOnly: true,
      bidirectionalSync: false,
      leadScoring: false,
      aiKanban: true,
      multiTenancy: false,
      piiMasking: true,
      observability: true,
      realtimeUpdates: true,
      forjEnabled: false,
      visitorTracking: false,
      funnelManagement: false,
      analytics: false,
      treasuryHunter: true,
      referralManagement: false,
    })

    resetFeatureFlags()

    const flags = getFeatureFlags()
    expect(flags.federationReadOnly).toBe(false)
    expect(flags.bidirectionalSync).toBe(true)
    expect(flags.leadScoring).toBe(true)
    expect(flags.aiKanban).toBe(false)
    expect(flags.multiTenancy).toBe(true)
    expect(flags.piiMasking).toBe(false)
    expect(flags.observability).toBe(false)
    expect(flags.realtimeUpdates).toBe(false)
    expect(flags.forjEnabled).toBe(true)
    expect(flags.visitorTracking).toBe(true)
    expect(flags.funnelManagement).toBe(true)
    expect(flags.analytics).toBe(true)
    expect(flags.treasuryHunter).toBe(false)
    expect(flags.referralManagement).toBe(true)
  })

  it('is idempotent -- calling reset twice yields the same state', () => {
    setFeatureFlags({ aiKanban: true })
    resetFeatureFlags()
    const first = { ...getFeatureFlags() }

    resetFeatureFlags()
    const second = getFeatureFlags()

    expect(second).toEqual(first)
  })

  it('produces a fresh object (not the same reference as a previous getFeatureFlags)', () => {
    const before = getFeatureFlags()
    resetFeatureFlags()
    const after = getFeatureFlags()

    // They should be structurally equal but not referentially identical
    expect(after).toEqual(before)
  })
})

describe('getFeatureFlags', () => {
  it('returns an object typed as Readonly<FeatureFlags>', () => {
    const flags = getFeatureFlags()
    // Runtime check: the object has all expected keys with boolean values
    const keys: (keyof FeatureFlags)[] = [
      'federationReadOnly',
      'bidirectionalSync',
      'leadScoring',
      'aiKanban',
      'multiTenancy',
      'piiMasking',
      'observability',
      'realtimeUpdates',
      'forjEnabled',
      'visitorTracking',
      'funnelManagement',
      'analytics',
      'treasuryHunter',
      'referralManagement',
    ]
    for (const key of keys) {
      expect(typeof flags[key]).toBe('boolean')
    }
  })

  it('returns all boolean values (no undefined or non-boolean fields)', () => {
    const flags = getFeatureFlags()
    for (const value of Object.values(flags)) {
      expect(typeof value).toBe('boolean')
    }
  })

  it('mutations to the returned object do not affect internal state', () => {
    const flags = getFeatureFlags() as Record<string, boolean>
    // Object.freeze means mutation throws in strict mode
    expect(() => {
      flags.aiKanban = true
    }).toThrow()

    // Internal state is unaffected
    const fresh = getFeatureFlags()
    expect(fresh.aiKanban).toBe(false)
  })

  it('returns a frozen object', () => {
    const flags = getFeatureFlags()
    expect(Object.isFrozen(flags)).toBe(true)
  })
})

describe('setFeatureFlags production guard', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
    resetFeatureFlags()
  })

  it('throws when called in production environment', () => {
    process.env.NODE_ENV = 'production'
    expect(() => setFeatureFlags({ aiKanban: true })).toThrow(
      'Cannot modify feature flags in production',
    )
  })

  it('allows modification in development environment', () => {
    process.env.NODE_ENV = 'development'
    expect(() => setFeatureFlags({ aiKanban: true })).not.toThrow()
    expect(getFeatureFlags().aiKanban).toBe(true)
  })

  it('allows modification in test environment', () => {
    process.env.NODE_ENV = 'test'
    expect(() => setFeatureFlags({ aiKanban: true })).not.toThrow()
    expect(getFeatureFlags().aiKanban).toBe(true)
  })
})

describe('production env feature overrides', () => {
  const originalEnv = process.env.NODE_ENV
  const originalTreasury = process.env.FEATURE_TREASURY_HUNTER

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
    if (originalTreasury === undefined) {
      delete process.env.FEATURE_TREASURY_HUNTER
    } else {
      process.env.FEATURE_TREASURY_HUNTER = originalTreasury
    }
    resetFeatureFlags()
  })

  it('enables treasuryHunter in production when FEATURE_TREASURY_HUNTER=true', () => {
    process.env.NODE_ENV = 'production'
    process.env.FEATURE_TREASURY_HUNTER = 'true'
    expect(isFeatureEnabled('treasuryHunter')).toBe(true)
  })

  it('does not apply production env overrides in test environment', () => {
    process.env.NODE_ENV = 'test'
    process.env.FEATURE_TREASURY_HUNTER = 'true'
    expect(isFeatureEnabled('treasuryHunter')).toBe(false)
  })
})

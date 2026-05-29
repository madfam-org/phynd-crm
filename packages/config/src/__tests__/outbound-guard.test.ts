import { afterEach, describe, expect, it } from 'vitest'
import {
  getDeploymentTier,
  isOutboundUrlAllowed,
  isProductionOutboundHost,
} from '../outbound-guard'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('outbound-guard', () => {
  it('detects production madfam hosts', () => {
    expect(isProductionOutboundHost('staging-karafiel.madfam.io')).toBe(false)
    expect(isProductionOutboundHost('karafiel.madfam.io')).toBe(true)
    expect(isProductionOutboundHost('crm.madfam.io')).toBe(true)
  })

  it('blocks staging tier from production outbound URLs', () => {
    process.env.PHYND_DEPLOYMENT_TIER = 'staging'
    expect(isOutboundUrlAllowed('https://karafiel.madfam.io/webhooks/phynd-crm')).toBe(false)
    expect(isOutboundUrlAllowed('https://staging-karafiel.madfam.io/webhooks/phynd-crm')).toBe(true)
  })

  it('allows production tier outbound calls', () => {
    process.env.PHYND_DEPLOYMENT_TIER = 'production'
    expect(isOutboundUrlAllowed('https://karafiel.madfam.io/webhooks/phynd-crm')).toBe(true)
  })

  it('infers staging from NEXT_PUBLIC_APP_URL', () => {
    delete process.env.PHYND_DEPLOYMENT_TIER
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging-phynd.app'
    expect(getDeploymentTier()).toBe('staging')
  })
})

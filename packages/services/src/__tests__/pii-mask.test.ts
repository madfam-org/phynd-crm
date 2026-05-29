import { resetFeatureFlags, setFeatureFlags } from '@phynd/config/features'
import { afterEach, describe, expect, it } from 'vitest'
import { maskEmail, maskPersonName, maskPhone, shouldMaskPiiForAgent } from '../pii/mask'

describe('pii mask', () => {
  afterEach(() => {
    resetFeatureFlags()
  })

  it('masks email for agent context', () => {
    expect(maskEmail('admin@madfam.io')).toBe('a***@madfam.io')
  })

  it('masks phone tail only', () => {
    expect(maskPhone('+52 55 1234 5678')).toBe('***5678')
  })

  it('masks person name to first token', () => {
    expect(maskPersonName('Rodrigo Tablaco')).toBe('Rodrigo ***')
  })

  it('enables masking for service auth when flag is on', () => {
    setFeatureFlags({ piiMasking: true })
    expect(
      shouldMaskPiiForAgent({
        userId: 'service:autoswarm',
        tenantId: 'madfam',
        roles: ['service'],
        scopes: ['contacts:read'],
        accessToken: '',
      }),
    ).toBe(true)
  })
})

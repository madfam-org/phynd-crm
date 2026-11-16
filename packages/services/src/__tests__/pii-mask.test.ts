import { resetFeatureFlags, setFeatureFlags } from '@phynd/config/features'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MASKED_VALUE,
  maskEmail,
  maskPersonName,
  maskPhone,
  maskWholeValue,
  shouldMaskPiiForAgent,
} from '../pii/mask'

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

  it('masks a whole value to a fixed marker that keeps nothing of it', () => {
    expect(maskWholeValue('Empresa Ejemplo S.A.')).toBe(MASKED_VALUE)
    expect(maskWholeValue('x')).toBe(MASKED_VALUE)
    expect(MASKED_VALUE).toBe('[redacted]')
    expect(maskWholeValue('')).toBeNull()
    expect(maskWholeValue(null)).toBeNull()
    expect(maskWholeValue(undefined)).toBeNull()
  })

  it('masks person name to first token', () => {
    expect(maskPersonName('Rodrigo Tablaco')).toBe('Rodrigo ***')
  })

  it('enables masking for service auth when flag is on', () => {
    setFeatureFlags({ piiMasking: true })
    expect(
      shouldMaskPiiForAgent({
        userId: 'service:selva',
        tenantId: 'madfam',
        roles: ['service'],
        scopes: ['contacts:read'],
        accessToken: '',
      }),
    ).toBe(true)
  })
})

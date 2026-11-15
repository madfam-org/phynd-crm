import { describe, expect, it } from 'vitest'

import { mcpSwitch } from '../auth'
import { MCP_READ_SCOPE, mcpEnabled, parseReadClients } from '../settings'

const MACHINE = {
  AUTH_JANUA_ISSUER: 'https://auth.janua.test',
  PHYND_CRM_MACHINE_TENANT_ID: 'madfam',
  PHYND_CRM_MACHINE_JANUA_ORG_ID: '00000000-0000-4000-8000-00000000a001',
}

describe('mcpEnabled', () => {
  it('is on for exactly "true" and nothing else', () => {
    expect(mcpEnabled('true')).toBe(true)
    for (const value of [
      undefined,
      '',
      'false',
      'TRUE',
      'True',
      '1',
      'yes',
      'on',
      ' true',
      'true ',
    ]) {
      expect(mcpEnabled(value)).toBe(false)
    }
  })
})

describe('mcpSwitch', () => {
  it('is off without the switch, whatever else is set', () => {
    expect(mcpSwitch({ ...MACHINE })).toEqual({ state: 'off' })
    expect(mcpSwitch({ ...MACHINE, PHYND_CRM_MCP_ENABLED: 'TRUE' })).toEqual({ state: 'off' })
  })

  it('is unconfigured when the switch is on but machine tokens are not set up', () => {
    expect(mcpSwitch({ PHYND_CRM_MCP_ENABLED: 'true' })).toEqual({ state: 'unconfigured' })
    expect(
      mcpSwitch({
        ...MACHINE,
        PHYND_CRM_MACHINE_TENANT_ID: 'demo-x',
        PHYND_CRM_MCP_ENABLED: 'true',
      }),
    ).toEqual({ state: 'unconfigured' })
  })

  it('is on with the switch and the machine configuration', () => {
    expect(mcpSwitch({ ...MACHINE, PHYND_CRM_MCP_ENABLED: 'true' })).toEqual({
      state: 'on',
      config: {
        issuer: 'https://auth.janua.test',
        audience: 'phynd-crm',
        tenantId: 'madfam',
        januaOrgId: MACHINE.PHYND_CRM_MACHINE_JANUA_ORG_ID,
      },
    })
  })
})

describe('parseReadClients', () => {
  it('reads client@org pairs', () => {
    expect([...(parseReadClients(' jnc_a@org-1 , jnc_b@org-1 ') ?? [])]).toEqual([
      ['jnc_a', 'org-1'],
      ['jnc_b', 'org-1'],
    ])
  })

  it('is empty when blank', () => {
    expect(parseReadClients(undefined)?.size).toBe(0)
    expect(parseReadClients('   ')?.size).toBe(0)
  })

  it.each([
    'jnc_a',
    '@org-1',
    'jnc_a@',
    'jnc_a@org-1,',
    'jnc_a@org 1',
    'jnc_a@org-1,jnc_a@org-2',
    '*@org-1',
  ])('fails closed on %s', (raw) => {
    expect(parseReadClients(raw)).toBeNull()
  })
})

describe('the scope', () => {
  it('has exactly one colon, as Janua registers scopes', () => {
    expect(MCP_READ_SCOPE.split(':')).toHaveLength(2)
  })
})

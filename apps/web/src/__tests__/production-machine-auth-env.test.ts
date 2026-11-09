import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { DEFAULT_MACHINE_AUDIENCE, machineAuthConfig } from '@/lib/trpc/machine-auth'

// Guards the production activation of Janua machine tokens
// (docs/MACHINE_AUTH.md). Production env comes from the Argo-synced
// infra/k8s/production manifests, not from .enclii.yml, so the web Deployment
// is where both switches must be declared. The values are run through the same
// machineAuthConfig() the request path uses, so a manifest value the code would
// refuse (a demo tenant, a blank org) fails here instead of silently leaving
// machine tokens off in production.

const WEB_DEPLOYMENT = fileURLToPath(
  new URL('../../../../infra/k8s/production/web-deployment.yaml', import.meta.url),
)

const MACHINE_KEYS = [
  'PHYND_CRM_MACHINE_TENANT_ID',
  'PHYND_CRM_MACHINE_JANUA_ORG_ID',
  'PHYND_CRM_MACHINE_AUDIENCE',
] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Literal `- name: X` / `value: "Y"` pairs declared in the manifest. */
function declaredLiteralEnv(source: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const match of source.matchAll(
    /^\s*- name: ([A-Z][A-Z0-9_]*)\n\s+value: "?([^"\n]*)"?$/gm,
  )) {
    const [, name, value] = match
    if (name && value !== undefined) env[name] = value
  }
  return env
}

/** Every env name the manifest declares, literal or valueFrom. */
function declaredEnvNames(source: string): string[] {
  return [...source.matchAll(/^\s*- name: ([A-Z][A-Z0-9_]*)$/gm)].map((match) => match[1] ?? '')
}

describe('production web Deployment: Janua machine tokens', () => {
  const source = readFileSync(WEB_DEPLOYMENT, 'utf8')
  const literal = declaredLiteralEnv(source)
  const machineEnv = Object.fromEntries(
    MACHINE_KEYS.filter((key) => key in literal).map((key) => [key, literal[key]]),
  )

  it('declares the tenant and the Janua org as literal values, each once', () => {
    const names = declaredEnvNames(source)
    for (const key of ['PHYND_CRM_MACHINE_TENANT_ID', 'PHYND_CRM_MACHINE_JANUA_ORG_ID'] as const) {
      expect(names.filter((name) => name === key)).toHaveLength(1)
      expect(literal[key]?.trim()).toBeTruthy()
    }
    expect(literal.PHYND_CRM_MACHINE_JANUA_ORG_ID).toMatch(UUID)
  })

  it('turns machine tokens on with the values the code accepts', () => {
    const config = machineAuthConfig({
      AUTH_JANUA_ISSUER: 'https://auth.example.test',
      ...machineEnv,
    })
    expect(config).toEqual({
      issuer: 'https://auth.example.test',
      audience: DEFAULT_MACHINE_AUDIENCE,
      tenantId: 'madfam',
      januaOrgId: literal.PHYND_CRM_MACHINE_JANUA_ORG_ID,
    })
  })

  it('keeps the default audience, the one Janua reserves for these clients', () => {
    expect(source).not.toMatch(/name: PHYND_CRM_MACHINE_AUDIENCE/)
    expect(DEFAULT_MACHINE_AUDIENCE).toBe('phynd-crm')
  })

  it('stays off without the issuer (staff sign-in config) even with both switches set', () => {
    expect(machineAuthConfig({ ...machineEnv })).toBeNull()
  })

  it('rolls back by removing the tenant alone', () => {
    const { PHYND_CRM_MACHINE_TENANT_ID: _tenant, ...withoutTenant } = machineEnv
    expect(
      machineAuthConfig({ AUTH_JANUA_ISSUER: 'https://auth.example.test', ...withoutTenant }),
    ).toBeNull()
  })
})

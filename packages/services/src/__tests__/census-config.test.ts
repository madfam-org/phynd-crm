import { describe, expect, it } from 'vitest'
import { CensusConfigError, readCensusConsumerSettings } from '../census/census-config'

const DEFAULT_URL = 'postgresql://crm@db.test:5432/crm'
const AGENCY_URL = 'postgresql://crm@db.test:5432/crm_agency_a'

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    PHYND_CRM_CENSUS_CONSUMER_ENABLED: 'true',
    PHYND_CRM_CENSUS_ORG_TENANTS: 'org_a=agency_a',
    DATABASE_URL: DEFAULT_URL,
    DATABASE_URL_AGENCY_A: AGENCY_URL,
    ...overrides,
  }
}

describe('readCensusConsumerSettings', () => {
  it('is off by default', () => {
    expect(readCensusConsumerSettings({}, 'madfam')).toEqual({ enabled: false })
  })

  it.each(['false', 'TRUE', '1', 'yes', ' true'])(
    'is off unless the flag is exactly true (%s)',
    (value) => {
      expect(
        readCensusConsumerSettings(env({ PHYND_CRM_CENSUS_CONSUMER_ENABLED: value }), 'madfam'),
      ).toEqual({ enabled: false })
    },
  )

  it('does not read the allowlist while off, even a malformed one', () => {
    expect(
      readCensusConsumerSettings({ PHYND_CRM_CENSUS_ORG_TENANTS: 'org_a=madfam' }, 'madfam'),
    ).toEqual({ enabled: false })
  })

  it('maps organizations to tenants that have their own database', () => {
    const settings = readCensusConsumerSettings(
      env({
        PHYND_CRM_CENSUS_ORG_TENANTS: ' org_a=agency_a , org_b=agency_b ',
        DATABASE_URL_AGENCY_B: 'postgresql://crm@db.test:5432/crm_agency_b',
      }),
      'madfam',
    )
    expect(settings.enabled).toBe(true)
    if (!settings.enabled) return
    expect([...settings.orgTenants]).toEqual([
      ['org_a', 'agency_a'],
      ['org_b', 'agency_b'],
    ])
    expect(settings.redisUrl).toBeUndefined()
  })

  it('starts with an empty allowlist (every hand-off is then skipped)', () => {
    const settings = readCensusConsumerSettings(
      env({ PHYND_CRM_CENSUS_ORG_TENANTS: undefined }),
      'madfam',
    )
    expect(settings.enabled && settings.orgTenants.size).toBe(0)
  })

  it.each([
    ['the built-in default tenant', 'org_a=madfam', {}],
    ['the configured default tenant', 'org_a=agency_a', {}, 'agency_a'],
    ['a tenant without its own database URL', 'org_a=agency_c', {}],
    [
      'a tenant whose URL is the default database',
      'org_a=agency_a',
      { DATABASE_URL_AGENCY_A: DEFAULT_URL },
    ],
    ['an entry without =', 'org_a', {}],
    ['an entry with two =', 'org_a=agency_a=x', {}],
    ['an empty org id', '=agency_a', {}],
    ['an org id with spaces', 'org a=agency_a', {}],
    ['an upper-case tenant id', 'org_a=Agency_A', {}],
    ['a tenant id with a dash', 'org_a=agency-a', {}],
    ['an organization listed twice', 'org_a=agency_a,org_a=agency_a', {}],
  ])('refuses %s', (_label, allowlist, extra, defaultTenant = 'madfam') => {
    expect(() =>
      readCensusConsumerSettings(
        env({ PHYND_CRM_CENSUS_ORG_TENANTS: allowlist, ...extra }),
        defaultTenant,
      ),
    ).toThrow(CensusConfigError)
  })

  it('reads a separate bus Redis URL and refuses a malformed one', () => {
    const settings = readCensusConsumerSettings(
      env({ PHYND_CRM_CENSUS_REDIS_URL: 'rediss://bus.test:6380' }),
      'madfam',
    )
    expect(settings.enabled && settings.redisUrl).toBe('rediss://bus.test:6380')
    expect(() =>
      readCensusConsumerSettings(env({ PHYND_CRM_CENSUS_REDIS_URL: 'http://bus.test' }), 'madfam'),
    ).toThrow(CensusConfigError)
  })

  it('never names the organization in its errors', () => {
    try {
      readCensusConsumerSettings(
        env({ PHYND_CRM_CENSUS_ORG_TENANTS: 'org_secret=madfam' }),
        'madfam',
      )
      expect.unreachable()
    } catch (err) {
      expect(String(err)).not.toContain('org_secret')
    }
  })
})

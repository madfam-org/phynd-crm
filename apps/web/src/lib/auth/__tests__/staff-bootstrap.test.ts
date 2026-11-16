import { describe, expect, it } from 'vitest'
import { matchStaffBootstrap, staffBootstrapEntries } from '../staff-bootstrap'

const SUB_A = '11111111-aaaa-4aaa-8aaa-000000000001'
const SUB_B = '22222222-bbbb-4bbb-8bbb-000000000002'

describe('staffBootstrapEntries', () => {
  it('reads <role>:sub:<subject> entries', () => {
    const entries = staffBootstrapEntries({
      PHYND_BOOTSTRAP_STAFF: ` admin:sub:${SUB_A} , manager:sub:${SUB_B}`,
    })
    expect(entries).toEqual([
      { role: 'admin', subject: SUB_A },
      { role: 'manager', subject: SUB_B },
    ])
  })

  it('rejects email entries: an email is never a bootstrap key', () => {
    const entries = staffBootstrapEntries({
      PHYND_BOOTSTRAP_STAFF: `admin:someone@example.test,manager:sub:${SUB_B}`,
    })
    expect(entries).toEqual([{ role: 'manager', subject: SUB_B }])
  })

  it('skips malformed entries: unknown role, no subject, bare value, spaces', () => {
    const entries = staffBootstrapEntries({
      PHYND_BOOTSTRAP_STAFF: `owner:sub:${SUB_A},service:sub:x,admin:sub:,admin,admin:${SUB_A},admin:sub:a b,viewer:sub:${SUB_B}`,
    })
    expect(entries).toEqual([{ role: 'viewer', subject: SUB_B }])
  })

  it('keeps PHYND_BOOTSTRAP_ADMIN_SUBS meaning admin, after the new list', () => {
    const entries = staffBootstrapEntries({
      PHYND_BOOTSTRAP_STAFF: `manager:sub:${SUB_A}`,
      PHYND_BOOTSTRAP_ADMIN_SUBS: ` ${SUB_A}, ${SUB_B} `,
    })
    expect(entries).toEqual([
      { role: 'manager', subject: SUB_A },
      { role: 'admin', subject: SUB_A },
      { role: 'admin', subject: SUB_B },
    ])
  })

  it('is empty when nothing is set', () => {
    expect(staffBootstrapEntries({})).toEqual([])
  })
})

describe('matchStaffBootstrap', () => {
  const entries = staffBootstrapEntries({
    PHYND_BOOTSTRAP_STAFF: `viewer:sub:${SUB_A},admin:sub:${SUB_A},manager:sub:${SUB_B}`,
  })

  it('matches the subject exactly; the first entry wins', () => {
    expect(matchStaffBootstrap(entries, SUB_A)).toBe('viewer')
    expect(matchStaffBootstrap(entries, SUB_B)).toBe('manager')
  })

  it('never matches a partial or empty subject', () => {
    expect(matchStaffBootstrap(entries, SUB_A.slice(0, 8))).toBeNull()
    expect(matchStaffBootstrap(entries, `${SUB_A}x`)).toBeNull()
    expect(matchStaffBootstrap(entries, '')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { matchStaffBootstrap, staffBootstrapEntries } from '../staff-bootstrap'

const SUB_A = '11111111-aaaa-4aaa-8aaa-000000000001'
const SUB_B = '22222222-bbbb-4bbb-8bbb-000000000002'

describe('staffBootstrapEntries', () => {
  it('reads <role>:<email> and <role>:sub:<subject> entries, lower-casing emails', () => {
    const entries = staffBootstrapEntries({
      PHYND_BOOTSTRAP_STAFF: ` admin:Ana@Example.test , manager:sub:${SUB_A},viewer:x@example.test`,
    })
    expect(entries).toEqual([
      { role: 'admin', email: 'ana@example.test' },
      { role: 'manager', subject: SUB_A },
      { role: 'viewer', email: 'x@example.test' },
    ])
  })

  it('skips malformed entries: unknown role, no target, not an address, empty subject', () => {
    const entries = staffBootstrapEntries({
      PHYND_BOOTSTRAP_STAFF:
        'owner:a@example.test,admin:,admin,service:sub:x,admin:not-an-email,admin:sub:,admin:a b@c.d,sales_rep:ok@example.test',
    })
    expect(entries).toEqual([{ role: 'sales_rep', email: 'ok@example.test' }])
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
    PHYND_BOOTSTRAP_STAFF: `admin:ana@example.test,manager:sub:${SUB_B}`,
  })

  it('matches a verified email exactly, ignoring case', () => {
    expect(
      matchStaffBootstrap(entries, {
        subject: SUB_A,
        email: 'ANA@example.test',
        emailVerified: true,
      }),
    ).toEqual({ role: 'admin', by: 'email' })
  })

  it('refuses the same email when it is not verified', () => {
    expect(
      matchStaffBootstrap(entries, {
        subject: SUB_A,
        email: 'ana@example.test',
        emailVerified: false,
      }),
    ).toBeNull()
  })

  it('never matches a partial address', () => {
    for (const email of ['xana@example.test', 'ana@example.test.evil', 'ana@example']) {
      expect(
        matchStaffBootstrap(entries, { subject: SUB_A, email, emailVerified: true }),
      ).toBeNull()
    }
  })

  it('matches a subject entry without looking at the email', () => {
    expect(
      matchStaffBootstrap(entries, { subject: SUB_B, email: null, emailVerified: false }),
    ).toEqual({ role: 'manager', by: 'subject' })
  })

  it('takes the first matching entry', () => {
    const both = staffBootstrapEntries({
      PHYND_BOOTSTRAP_STAFF: `viewer:sub:${SUB_A},admin:ana@example.test`,
    })
    expect(
      matchStaffBootstrap(both, { subject: SUB_A, email: 'ana@example.test', emailVerified: true }),
    ).toEqual({ role: 'viewer', by: 'subject' })
  })
})

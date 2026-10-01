import { CRM_USER_NOT_LINKED } from '@phynd/types/auth'
import { describe, expect, it } from 'vitest'
import { isCrmUserNotLinkedError, shouldRetryQuery } from '../errors'

const notLinked = Object.assign(new Error('x'), { data: { appCode: CRM_USER_NOT_LINKED } })

describe('isCrmUserNotLinkedError', () => {
  it('recognises the not-linked tRPC error by its appCode', () => {
    expect(isCrmUserNotLinkedError(notLinked)).toBe(true)
  })

  it.each([
    null,
    undefined,
    'CRM_USER_NOT_LINKED',
    new Error('CRM_USER_NOT_LINKED'),
    { data: null },
    { data: { appCode: 'CONFLICT' } },
  ])('ignores %j', (err) => {
    expect(isCrmUserNotLinkedError(err)).toBe(false)
  })
})

describe('shouldRetryQuery', () => {
  it('never retries a not-linked error', () => {
    expect(shouldRetryQuery(0, notLinked)).toBe(false)
  })

  it('retries other errors up to three times', () => {
    const other = new Error('network')
    expect([0, 1, 2, 3].map((n) => shouldRetryQuery(n, other))).toEqual([true, true, true, false])
  })
})

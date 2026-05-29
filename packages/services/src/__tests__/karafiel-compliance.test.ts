import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  evaluateKarafielComplianceStatus,
  summarizeKarafielCompliance,
} from '../grants/karafiel-compliance'

describe('karafiel-compliance', () => {
  it('returns unavailable when contact has no grant applications', () => {
    const summary = summarizeKarafielCompliance([])
    assert.equal(summary.status, 'unavailable')
    assert.equal(summary.source, 'none')
  })

  it('returns pending when applications exist without compliance checks', () => {
    const summary = summarizeKarafielCompliance([
      {
        id: 'grant-app-1',
        applicationDraft: { rfc: 'TABL900101ABC' },
        complianceChecks: {},
      },
    ])
    assert.equal(summary.status, 'pending')
    assert.equal(summary.rfc, 'TABL900101ABC')
    assert.equal(summary.grantApplicationId, 'grant-app-1')
  })

  it('returns ok when all compliance checks pass', () => {
    const summary = summarizeKarafielCompliance([
      {
        id: 'grant-app-2',
        applicationDraft: { rfc: 'TABL900101ABC' },
        complianceChecks: {
          rfc_active: true,
          opinion_32d_positive: true,
          blacklisted: false,
          checked_at: '2026-05-28T12:00:00.000Z',
        },
      },
    ])
    assert.equal(summary.status, 'ok')
    assert.equal(summary.checks.checked_at, '2026-05-28T12:00:00.000Z')
  })

  it('returns failed when any compliance check fails', () => {
    const summary = summarizeKarafielCompliance([
      {
        id: 'grant-app-3',
        applicationDraft: {},
        complianceChecks: {
          rfc_active: true,
          opinion_32d_positive: false,
          blacklisted: false,
        },
      },
    ])
    assert.equal(summary.status, 'failed')
  })

  it('prefers the newest application that has compliance data', () => {
    const summary = summarizeKarafielCompliance([
      {
        id: 'grant-app-new',
        applicationDraft: { rfc: 'NEW-RFC' },
        complianceChecks: {},
      },
      {
        id: 'grant-app-old',
        applicationDraft: { rfc: 'OLD-RFC' },
        complianceChecks: {
          rfc_active: true,
          opinion_32d_positive: true,
          blacklisted: false,
        },
      },
    ])
    assert.equal(summary.grantApplicationId, 'grant-app-old')
    assert.equal(summary.status, 'ok')
  })

  it('evaluateKarafielComplianceStatus treats missing data as pending', () => {
    assert.equal(evaluateKarafielComplianceStatus({}), 'pending')
  })
})

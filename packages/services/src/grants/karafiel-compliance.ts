import type {
  KarafielComplianceChecks,
  KarafielComplianceStatus,
  KarafielComplianceSummary,
} from '@phynd/types/federation'

export interface GrantApplicationComplianceRow {
  id: string
  applicationDraft: unknown
  complianceChecks: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

export function extractRfcFromApplicationDraft(applicationDraft: unknown): string | null {
  const draft = asRecord(applicationDraft)
  const rfc = draft.rfc
  return typeof rfc === 'string' && rfc.trim().length > 0 ? rfc.trim() : null
}

export function normalizeKarafielComplianceChecks(value: unknown): KarafielComplianceChecks {
  const checks = asRecord(value)
  const normalized: KarafielComplianceChecks = {}

  if (typeof checks.rfc_active === 'boolean') {
    normalized.rfc_active = checks.rfc_active
  }
  if (typeof checks.opinion_32d_positive === 'boolean') {
    normalized.opinion_32d_positive = checks.opinion_32d_positive
  }
  if (typeof checks.blacklisted === 'boolean') {
    normalized.blacklisted = checks.blacklisted
  }
  if (typeof checks.checked_at === 'string' && checks.checked_at.trim().length > 0) {
    normalized.checked_at = checks.checked_at
  }

  return normalized
}

export function hasKarafielComplianceData(checks: KarafielComplianceChecks): boolean {
  return (
    typeof checks.rfc_active === 'boolean' ||
    typeof checks.opinion_32d_positive === 'boolean' ||
    typeof checks.blacklisted === 'boolean' ||
    Boolean(checks.checked_at)
  )
}

export function evaluateKarafielComplianceStatus(
  checks: KarafielComplianceChecks,
): Exclude<KarafielComplianceStatus, 'unavailable'> {
  if (!hasKarafielComplianceData(checks)) {
    return 'pending'
  }

  const pass =
    checks.rfc_active === true &&
    checks.opinion_32d_positive === true &&
    checks.blacklisted === false

  return pass ? 'ok' : 'failed'
}

export function summarizeKarafielCompliance(
  applications: GrantApplicationComplianceRow[],
): KarafielComplianceSummary {
  if (applications.length === 0) {
    return {
      status: 'unavailable',
      rfc: null,
      checks: {},
      grantApplicationId: null,
      source: 'none',
    }
  }

  const withChecks = applications.find((application) =>
    hasKarafielComplianceData(normalizeKarafielComplianceChecks(application.complianceChecks)),
  )
  const selected = withChecks ?? applications[0]
  if (!selected) {
    return {
      status: 'unavailable',
      rfc: null,
      checks: {},
      grantApplicationId: null,
      source: 'none',
    }
  }
  const checks = normalizeKarafielComplianceChecks(selected.complianceChecks)
  const rfc = extractRfcFromApplicationDraft(selected.applicationDraft)

  return {
    status: evaluateKarafielComplianceStatus(checks),
    rfc,
    checks,
    grantApplicationId: selected.id,
    source: 'grant_application',
  }
}

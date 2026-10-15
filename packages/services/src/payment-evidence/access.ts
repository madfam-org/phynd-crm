import type { PaymentEvidence } from '@phynd/db/schema'

export type EvidenceViewer = { kind: 'staff' } | { kind: 'portal'; engagementId: string }

/**
 * Who may open an evidence file. Staff: any receipt that has a file. Portal
 * viewers (already authorized for `engagementId` by resolvePortalAccess): only
 * client-visible, non-voided receipts of that same engagement.
 */
export function canViewEvidence(
  viewer: EvidenceViewer,
  evidence: Pick<
    PaymentEvidence,
    'engagementId' | 'clientVisible' | 'status' | 'evidenceStorageKey'
  >,
): boolean {
  if (!evidence.evidenceStorageKey) return false
  if (viewer.kind === 'staff') return true
  return (
    evidence.engagementId === viewer.engagementId &&
    evidence.clientVisible &&
    evidence.status !== 'voided'
  )
}

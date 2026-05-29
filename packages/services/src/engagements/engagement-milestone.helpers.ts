/** Canonical milestone names from docs/ENGAGEMENT_EVENT_TAXONOMY.md */

export function canonicalSelvaMilestone(eventName: string): string | null {
  const normalized = eventName.toLowerCase().replace(/^selva:/, '')
  if (normalized === 'milestone_complete' || normalized === 'deliverable_ready') {
    return 'deliverable_ready'
  }
  if (normalized === 'digital_handoff' || normalized === 'handoff_complete') {
    return 'digital_handoff'
  }
  return null
}

export function canonicalKarafielMilestone(eventName: string): string | null {
  const normalized = eventName
    .toLowerCase()
    .replace(/^karafiel:/, '')
    .replace(/\./g, '_')
  if (normalized === 'cfdi_stamped' || normalized === 'grant_cfdi_stamped') {
    return 'cfdi_stamped'
  }
  if (normalized === 'nom151_stamped' || normalized === 'nom_151_stamped') {
    return 'nom151_stamped'
  }
  return null
}

export function selvaPortalStatus(eventName: string): string {
  const canonical = canonicalSelvaMilestone(eventName)
  if (canonical === 'digital_handoff') return 'completed'
  if (canonical === 'deliverable_ready') return 'milestone'
  return 'in_progress'
}

export function karafielPortalStatus(eventName: string): string {
  return canonicalKarafielMilestone(eventName) ? 'milestone' : 'in_progress'
}

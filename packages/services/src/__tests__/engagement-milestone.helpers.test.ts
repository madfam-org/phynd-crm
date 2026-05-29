import { describe, expect, it } from 'vitest'

import {
  canonicalKarafielMilestone,
  canonicalSelvaMilestone,
} from '../engagements/engagement-milestone.helpers'

describe('engagement milestone helpers', () => {
  it('maps selva milestone_complete to deliverable_ready', () => {
    expect(canonicalSelvaMilestone('milestone_complete')).toBe('deliverable_ready')
    expect(canonicalSelvaMilestone('digital_handoff')).toBe('digital_handoff')
  })

  it('maps karafiel cfdi events to cfdi_stamped', () => {
    expect(canonicalKarafielMilestone('cfdi.stamped')).toBe('cfdi_stamped')
    expect(canonicalKarafielMilestone('nom151_stamped')).toBe('nom151_stamped')
  })
})

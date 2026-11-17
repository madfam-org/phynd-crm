import type { ScoringCondition } from '@phynd/types/crm'

/**
 * The lead-scoring rules migration 0024 seeds (docs/LEAD_INTAKE_GAPS_AND_ENRICHMENT_2026-11-16.md
 * § G2). The migration is what writes them; this copy documents them in code
 * and lets the tests check each rule's effect and that the SQL matches. Staff
 * edit them afterwards in Settings › Scoring.
 */
export interface SeededScoringRule {
  id: string
  name: string
  category: 'demographic' | 'behavior' | 'engagement'
  condition: ScoringCondition
  points: number
}

export const SEEDED_SCORING_RULES: readonly SeededScoringRule[] = [
  {
    id: '7a5e0c00-2026-4117-8000-000000000001',
    name: 'Intent: sales request',
    category: 'behavior',
    condition: { field: 'intent', operator: 'eq', value: 'sales-request' },
    points: 4,
  },
  {
    id: '7a5e0c00-2026-4117-8000-000000000002',
    name: 'Intent: request access',
    category: 'behavior',
    condition: { field: 'intent', operator: 'eq', value: 'request-access' },
    points: 2,
  },
  {
    id: '7a5e0c00-2026-4117-8000-000000000003',
    name: 'Intent: request access from a demo or Comply page',
    category: 'behavior',
    condition: {
      field: 'intent',
      operator: 'eq',
      value: 'request-access',
      all: [
        {
          field: 'source',
          operator: 'in',
          value: ['demo-home', 'demo-home-bottom', 'producto-comply'],
        },
      ],
    },
    points: 1,
  },
  {
    id: '7a5e0c00-2026-4117-8000-000000000004',
    name: 'Intent: waitlist',
    category: 'behavior',
    condition: { field: 'intent', operator: 'eq', value: 'waitlist' },
    points: 1,
  },
  {
    id: '7a5e0c00-2026-4117-8000-000000000005',
    name: 'Fit: company email domain (not free-mail)',
    category: 'demographic',
    condition: { field: 'email_free_mail', operator: 'eq', value: false },
    points: 2,
  },
  {
    id: '7a5e0c00-2026-4117-8000-000000000006',
    name: 'Fit: interested in DC-3 or compliance',
    category: 'demographic',
    condition: { field: 'interests', operator: 'in', value: ['dc3', 'compliance'] },
    points: 1,
  },
  {
    id: '7a5e0c00-2026-4117-8000-000000000007',
    name: 'Recency: older than 30 days',
    category: 'engagement',
    condition: { field: 'lead_age_days', operator: 'gt', value: 30 },
    points: -1,
  },
  {
    id: '7a5e0c00-2026-4117-8000-000000000008',
    name: 'Recency: older than 60 days',
    category: 'engagement',
    condition: { field: 'lead_age_days', operator: 'gt', value: 60 },
    points: -1,
  },
  {
    id: '7a5e0c00-2026-4117-8000-000000000009',
    name: 'Reachability: phone number present',
    category: 'engagement',
    condition: { field: 'has_phone', operator: 'eq', value: true },
    points: 1,
  },
  {
    id: '7a5e0c00-2026-4117-8000-00000000000a',
    name: 'Repeat: another submission within 7 days',
    category: 'engagement',
    condition: { field: 'repeat_submissions_7d', operator: 'gte', value: 1 },
    points: 1,
  },
  {
    id: '7a5e0c00-2026-4117-8000-00000000000b',
    name: 'Repeat: a second one within 7 days',
    category: 'engagement',
    condition: { field: 'repeat_submissions_7d', operator: 'gte', value: 2 },
    points: 1,
  },
]

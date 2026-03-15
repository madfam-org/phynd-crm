import { leadScoringRules } from '../schema/lead-scoring-rules'
import type { Db } from './types'

export async function seedScoringRules(db: Db) {
  await db.insert(leadScoringRules).values([
    {
      name: 'Website Source',
      category: 'demographic',
      condition: [{ field: 'source', operator: 'eq', value: 'website' }],
      points: 10,
      isActive: true,
    },
    {
      name: 'Referral Source',
      category: 'demographic',
      condition: [{ field: 'source', operator: 'eq', value: 'referral' }],
      points: 25,
      isActive: true,
    },
    {
      name: 'Qualified Status',
      category: 'demographic',
      condition: [{ field: 'status', operator: 'eq', value: 'qualified' }],
      points: 20,
      isActive: true,
    },
    {
      name: 'Multiple Sessions',
      category: 'behavior',
      condition: [{ field: 'session_count', operator: 'gte', value: '3' }],
      points: 15,
      isActive: true,
    },
    {
      name: 'High Page Views',
      category: 'behavior',
      condition: [{ field: 'page_view_count', operator: 'gte', value: '5' }],
      points: 10,
      isActive: true,
    },
    {
      name: 'Has Contact Info',
      category: 'engagement',
      condition: [{ field: 'has_contact', operator: 'eq', value: 'true' }],
      points: 15,
      isActive: true,
    },
    {
      name: 'Viewed Pricing',
      category: 'behavior',
      condition: [{ field: 'page_url', operator: 'contains', value: 'pricing' }],
      points: 20,
      isActive: true,
    },
    {
      name: '3D Asset Engagement',
      category: 'engagement',
      condition: [{ field: '3d_asset_views', operator: 'gte', value: '1' }],
      points: 15,
      isActive: true,
    },
  ])
}

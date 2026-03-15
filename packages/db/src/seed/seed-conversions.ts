import { conversions } from '../schema/conversions'
import type { Db, SeedIds } from './types'

export async function seedConversions(db: Db, ids: SeedIds) {
  const { contacts: c, leads: l, campaigns: camp } = ids

  await db.insert(conversions).values([
    {
      type: 'visitor_to_lead',
      contactId: c[0]?.id,
      leadId: l[0]?.id,
      campaignId: camp[0]?.id,
      value: '0',
    },
    {
      type: 'lead_to_opportunity',
      contactId: c[0]?.id,
      leadId: l[0]?.id,
      campaignId: camp[0]?.id,
      value: '50000.00',
    },
    { type: 'opportunity_to_won', contactId: c[2]?.id, value: '80000.00' },
  ])
}

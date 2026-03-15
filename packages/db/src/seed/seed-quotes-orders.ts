import { orders } from '../schema/orders'
import { quotes } from '../schema/quotes'
import type { Db, SeedIds } from './types'

export async function seedQuotesAndOrders(db: Db, ids: SeedIds) {
  const { adminId, contacts: c, opps } = ids

  const sampleQuotes = await db
    .insert(quotes)
    .values([
      {
        quoteNumber: 'Q-2025-001',
        opportunityId: opps[0]?.id,
        contactId: c[0]?.id,
        status: 'sent',
        totalAmount: '48000.00',
        currency: 'USD',
        validUntil: new Date('2025-06-30'),
        ownerId: adminId,
      },
      {
        quoteNumber: 'Q-2025-002',
        opportunityId: opps[1]?.id,
        contactId: c[1]?.id,
        status: 'accepted',
        totalAmount: '25000.00',
        currency: 'USD',
        validUntil: new Date('2025-04-30'),
        ownerId: adminId,
      },
      {
        quoteNumber: 'Q-2025-003',
        opportunityId: opps[2]?.id,
        contactId: c[2]?.id,
        status: 'accepted',
        totalAmount: '80000.00',
        currency: 'USD',
        ownerId: adminId,
      },
    ])
    .returning()

  await db.insert(orders).values([
    {
      orderNumber: 'ORD-2025-001',
      opportunityId: opps[1]?.id,
      quoteId: sampleQuotes[1]?.id,
      contactId: c[1]?.id,
      status: 'confirmed',
      totalAmount: '25000.00',
      currency: 'USD',
      estimatedCompletion: new Date('2025-05-15'),
      ownerId: adminId,
    },
    {
      orderNumber: 'ORD-2025-002',
      opportunityId: opps[2]?.id,
      quoteId: sampleQuotes[2]?.id,
      contactId: c[2]?.id,
      status: 'fulfilled',
      totalAmount: '80000.00',
      currency: 'USD',
      estimatedCompletion: new Date('2025-03-01'),
      actualCompletion: new Date('2025-02-28'),
      ownerId: adminId,
    },
    {
      orderNumber: 'ORD-2025-003',
      contactId: c[3]?.id,
      status: 'in_production',
      totalAmount: '12000.00',
      currency: 'USD',
      estimatedCompletion: new Date('2025-07-01'),
      ownerId: adminId,
    },
  ])

  return { quotes: sampleQuotes }
}

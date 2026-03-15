import { externalReferences } from '../schema/external-references'
import type { Db, SeedIds } from './types'

export async function seedExternalRefs(db: Db, ids: SeedIds) {
  await db.insert(externalReferences).values([
    {
      entityType: 'contact',
      entityId: ids.contacts[0]?.id ?? '',
      provider: 'janua',
      externalId: 'janua-user-001',
      metadata: { roles: ['customer'] },
    },
    {
      entityType: 'contact',
      entityId: ids.contacts[0]?.id ?? '',
      provider: 'dhanam',
      externalId: 'dhanam-cust-001',
      metadata: { plan: 'enterprise' },
    },
    {
      entityType: 'contact',
      entityId: ids.contacts[2]?.id ?? '',
      provider: 'pravara',
      externalId: 'pravara-contact-001',
      metadata: { activeOrders: 2 },
    },
  ])
}

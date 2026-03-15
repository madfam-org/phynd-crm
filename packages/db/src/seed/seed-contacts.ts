import { contacts } from '../schema/contacts'
import type { Db } from './types'

export async function seedContacts(db: Db, adminId: string) {
  return db
    .insert(contacts)
    .values([
      {
        name: 'Alice Johnson',
        email: 'alice@techcorp.com',
        company: 'TechCorp',
        phone: '+1-555-0101',
        status: 'active',
        ownerId: adminId,
      },
      {
        name: 'Bob Smith',
        email: 'bob@designlab.com',
        company: 'DesignLab',
        phone: '+1-555-0102',
        status: 'active',
        ownerId: adminId,
      },
      {
        name: 'Carol White',
        email: 'carol@mfgworks.com',
        company: 'MfgWorks',
        phone: '+1-555-0103',
        status: 'active',
        ownerId: adminId,
      },
      {
        name: 'David Chen',
        email: 'david@innovatech.com',
        company: 'InnovaTech',
        phone: '+1-555-0104',
        status: 'active',
        ownerId: adminId,
      },
      {
        name: 'Emma Garcia',
        email: 'emma@retailplus.com',
        company: 'RetailPlus',
        status: 'inactive',
        ownerId: adminId,
      },
    ])
    .returning()
}

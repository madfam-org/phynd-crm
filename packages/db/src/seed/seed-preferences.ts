import { roleViewPreferences } from '../schema/role-preferences'
import type { Db } from './types'

export async function seedPreferences(db: Db) {
  await db.insert(roleViewPreferences).values([
    {
      role: 'sales_rep',
      panelOrder: ['identity', 'billing', 'manufacturing', 'fabrication', 'assets'],
      defaultTab: 'identity',
    },
    {
      role: 'manufacturing',
      panelOrder: ['manufacturing', 'fabrication', 'assets', 'identity', 'billing'],
      defaultTab: 'manufacturing',
    },
    {
      role: 'finance',
      panelOrder: ['billing', 'identity', 'manufacturing', 'fabrication', 'assets'],
      defaultTab: 'billing',
    },
    {
      role: 'admin',
      panelOrder: ['identity', 'billing', 'manufacturing', 'fabrication', 'assets'],
      defaultTab: 'identity',
    },
  ])
}

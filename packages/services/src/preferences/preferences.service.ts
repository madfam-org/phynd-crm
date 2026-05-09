import { roleViewPreferences } from '@phynd/db/schema'
import { eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export class PreferencesService {
  constructor(private readonly ctx: ServiceContext) {}

  async getForRole(role: string) {
    const [pref] = await this.ctx.db
      .select()
      .from(roleViewPreferences)
      .where(eq(roleViewPreferences.role, role))
    return pref ?? null
  }

  async upsert(data: {
    role: string
    panelOrder?: string[]
    defaultTab?: string | null
    visibleColumns?: Record<string, string[]> | null
  }) {
    const [result] = await this.ctx.db
      .insert(roleViewPreferences)
      .values({
        role: data.role,
        panelOrder: data.panelOrder ?? [],
        defaultTab: data.defaultTab,
        visibleColumns: data.visibleColumns,
      })
      .onConflictDoUpdate({
        target: roleViewPreferences.role,
        set: {
          panelOrder: data.panelOrder ?? [],
          defaultTab: data.defaultTab,
          visibleColumns: data.visibleColumns,
          updatedAt: new Date(),
        },
      })
      .returning()
    // biome-ignore lint/style/noNonNullAssertion: Drizzle .returning() always returns the upserted row
    return result!
  }
}

import { contacts, leads, opportunities } from '@phynd/db/schema'
import { and, ilike, isNull, or } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export interface SearchResult {
  id: string
  entityType: 'contact' | 'lead' | 'opportunity'
  title: string
  subtitle: string | null
}

export class SearchService {
  constructor(private readonly ctx: ServiceContext) {}

  async search(query: string, options?: { limit?: number }): Promise<SearchResult[]> {
    const limit = options?.limit ?? 20
    const pattern = `%${query}%`

    const [contactResults, leadResults, oppResults] = await Promise.all([
      this.ctx.db
        .select()
        .from(contacts)
        .where(
          or(
            ilike(contacts.name, pattern),
            ilike(contacts.email, pattern),
            ilike(contacts.company, pattern),
          ),
        )
        .limit(limit),

      this.ctx.db
        .select()
        .from(leads)
        .where(and(ilike(leads.source, pattern), isNull(leads.deletedAt)))
        .limit(limit),

      this.ctx.db
        .select()
        .from(opportunities)
        .where(and(ilike(opportunities.name, pattern), isNull(opportunities.deletedAt)))
        .limit(limit),
    ])

    const results: SearchResult[] = [
      ...contactResults.map((c) => ({
        id: c.id,
        entityType: 'contact' as const,
        title: c.name,
        subtitle: c.company,
      })),
      ...leadResults.map((l) => ({
        id: l.id,
        entityType: 'lead' as const,
        title: `Lead: ${l.source ?? 'Unknown'}`,
        subtitle: l.status,
      })),
      ...oppResults.map((o) => ({
        id: o.id,
        entityType: 'opportunity' as const,
        title: o.name,
        subtitle: o.value ? `$${Number(o.value).toLocaleString()}` : null,
      })),
    ]

    return results.slice(0, limit)
  }
}

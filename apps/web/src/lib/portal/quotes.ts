import type { getDb } from '@phynd/db'
import { engagementEvents, orders, quotes } from '@phynd/db/schema'
import type { PortalEngagement } from '@phynd/services'
import { and, desc, eq, isNull } from 'drizzle-orm'

type Db = ReturnType<typeof getDb>
export type PortalQuote = typeof quotes.$inferSelect
export type PortalOrder = typeof orders.$inferSelect
export interface PortalQuoteCard {
  quote: PortalQuote
  order: PortalOrder | null
}

/** Quotes of the engagement's opportunity (else its contact) the client may see. */
export async function findPortalQuotes(db: Db, engagement: PortalEngagement) {
  const rows = engagement.opportunityId
    ? await db
        .select()
        .from(quotes)
        .where(and(eq(quotes.opportunityId, engagement.opportunityId), isNull(quotes.deletedAt)))
        .orderBy(desc(quotes.createdAt))
        .limit(10)
    : await db
        .select()
        .from(quotes)
        .where(and(eq(quotes.contactId, engagement.contactId), isNull(quotes.deletedAt)))
        .orderBy(desc(quotes.createdAt))
        .limit(10)

  return rows.filter((quote: PortalQuote) => ['draft', 'sent', 'accepted'].includes(quote.status))
}

export async function buildQuoteCards(db: Db, portalQuotes: PortalQuote[]) {
  return Promise.all(
    portalQuotes.map(async (quote: PortalQuote): Promise<PortalQuoteCard> => {
      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.quoteId, quote.id), isNull(orders.deletedAt)))
        .orderBy(desc(orders.createdAt))
        .limit(1)
      return { order: order ?? null, quote }
    }),
  )
}

/** Artifact ids the client already accepted from the portal. */
export async function loadAcceptedDeliverableIds(db: Db, engagementId: string) {
  const rows = await db
    .select({ metadata: engagementEvents.metadata })
    .from(engagementEvents)
    .where(
      and(
        eq(engagementEvents.engagementId, engagementId),
        eq(engagementEvents.eventType, 'portal:deliverable_accepted'),
      ),
    )

  const ids = new Set<string>()
  for (const row of rows) {
    const artifactId = row.metadata?.artifact_id
    if (typeof artifactId === 'string') ids.add(artifactId)
  }
  return ids
}

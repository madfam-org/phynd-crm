import {
  engagementArtifacts,
  engagementEvents,
  engagements,
  quotes,
} from '@phynd/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { EngagementPortalMagicLinkService } from '../engagement-portal/magic-link.service'
import { NotFoundError, ValidationError } from '../errors'

type PublishTx = Parameters<Parameters<ServiceContext['db']['transaction']>[0]>[0]

export interface PublishQuoteToPortalInput {
  engagementId: string
  quoteId?: string
}

export interface PublishQuoteToPortalResult {
  quoteId: string
  quoteNumber: string
  quoteStatus: string
  alreadyPublished: boolean
}

export class PublishQuoteToPortalService {
  constructor(private readonly ctx: ServiceContext) {}

  async publish(input: PublishQuoteToPortalInput): Promise<PublishQuoteToPortalResult> {
    return this.ctx.db.transaction(async (tx) => {
      const engagement = await getEngagement(tx, input.engagementId)
      const quote = input.quoteId
        ? await getQuoteForEngagement(tx, engagement, input.quoteId)
        : await findPublishableQuote(tx, engagement)

      if (!quote) {
        throw new NotFoundError(
          'Quote',
          input.quoteId ?? `engagement:${input.engagementId}`,
        )
      }

      if (quote.status !== 'draft' && quote.status !== 'sent') {
        throw new ValidationError(
          `Quote ${quote.quoteNumber} cannot be published from status ${quote.status}`,
        )
      }

      const alreadyPublished = quote.status === 'sent'
      let published = quote

      if (!alreadyPublished) {
        const [updated] = await tx
          .update(quotes)
          .set({ status: 'sent' })
          .where(eq(quotes.id, quote.id))
          .returning()
        published = updated ?? { ...quote, status: 'sent' }

        await tx.insert(engagementEvents).values({
          engagementId: engagement.id,
          source: 'system',
          eventType: 'system:quote_sent',
          status: 'milestone',
          message: `Quote ${published.quoteNumber} sent to client portal`,
          metadata: {
            quote_id: published.id,
            quote_number: published.quoteNumber,
            published_by: this.ctx.auth.userId,
          },
          dedupKey: `system:quote_sent:${published.id}`,
        })

        await ensureQuoteArtifact(tx, engagement.id, published)
      }

      return {
        quoteId: published.id,
        quoteNumber: published.quoteNumber,
        quoteStatus: published.status,
        alreadyPublished,
      }
    })
  }

  async publishAndSendPortalLink(input: PublishQuoteToPortalInput) {
    const published = await this.publish(input)
    const portal = new EngagementPortalMagicLinkService(this.ctx)
    const sent = await portal.sendPortalLink(input.engagementId)
    return { ...published, portal: sent }
  }
}

async function getEngagement(tx: PublishTx, engagementId: string) {
  const [engagement] = await tx
    .select()
    .from(engagements)
    .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
    .limit(1)

  if (!engagement) {
    throw new NotFoundError('Engagement', engagementId)
  }

  return engagement
}

async function getQuoteForEngagement(
  tx: PublishTx,
  engagement: typeof engagements.$inferSelect,
  quoteId: string,
) {
  const [quote] = await tx
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), isNull(quotes.deletedAt)))
    .limit(1)

  if (!quote) return null
  if (!quoteBelongsToEngagement(quote, engagement)) {
    throw new ValidationError('Quote does not belong to this engagement')
  }

  return quote
}

async function findPublishableQuote(
  tx: PublishTx,
  engagement: typeof engagements.$inferSelect,
) {
  const conditions = [isNull(quotes.deletedAt)]
  if (engagement.opportunityId) {
    conditions.push(eq(quotes.opportunityId, engagement.opportunityId))
  } else {
    conditions.push(eq(quotes.contactId, engagement.contactId))
  }

  const rows = await tx
    .select()
    .from(quotes)
    .where(and(...conditions))
    .orderBy(desc(quotes.createdAt))
    .limit(10)

  return rows.find((quote) => quote.status === 'draft' || quote.status === 'sent') ?? rows[0] ?? null
}

function quoteBelongsToEngagement(
  quote: typeof quotes.$inferSelect,
  engagement: typeof engagements.$inferSelect,
) {
  if (engagement.opportunityId && quote.opportunityId === engagement.opportunityId) {
    return true
  }
  return quote.contactId === engagement.contactId
}

async function ensureQuoteArtifact(
  tx: PublishTx,
  engagementId: string,
  quote: typeof quotes.$inferSelect,
) {
  const [existing] = await tx
    .select({ id: engagementArtifacts.id })
    .from(engagementArtifacts)
    .where(
      and(
        eq(engagementArtifacts.engagementId, engagementId),
        eq(engagementArtifacts.entityType, 'quote'),
        eq(engagementArtifacts.entityId, quote.id),
      ),
    )
    .limit(1)

  if (existing) return

  await tx.insert(engagementArtifacts).values({
    engagementId,
    type: 'quote',
    entityType: 'quote',
    entityId: quote.id,
    title: `Quote ${quote.quoteNumber}`,
    metadata: {
      quote_number: quote.quoteNumber,
      status: quote.status,
      total_amount: quote.totalAmount,
      currency: quote.currency,
    },
  })
}

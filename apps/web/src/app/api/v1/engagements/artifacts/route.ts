import { handleWebhook } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { NoopCacheManager } from '@phynd/federation'
import { createLogger } from '@phynd/logging'
import { EngagementsService } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:engagements-artifacts')

// Phase D-1: Cotiza (and other ecosystem services) POST signed
// proposals / invoices / deliverable links / NFT receipts here so they
// show up on the client portal. Shares the same HMAC secret as
// /api/v1/engagements/events — service-to-service trust boundary is
// at the network edge.
//
// Expected payload:
//   {
//     engagement_id: string,
//     type: 'quote'|'signed_proposal'|'invoice'|'deliverable'|'nft_receipt',
//     entity_type?: 'quote'|'order'|'external_reference',
//     entity_id?: string,
//     url?: string,          // public or presigned URL — portal links to this
//     title?: string,        // human-friendly display label
//     metadata?: Record<string, unknown>
//   }
//
// Secret: PHYND_ENGAGEMENT_EVENTS_SECRET (same as events webhook).
//
// Signature (#71): modern-first `x-madfam-signature` (t=<unix>,v1=<hmac of
// "t.body">) — what nauta's publishArtifact signs — with the legacy
// `x-webhook-signature` kept as a deprecation window for cotiza's
// recordArtifact (signed-proposal PDFs). Same decision + evidence as the
// events route one directory over; drop 'legacy' together with it.
export async function POST(req: Request) {
  const secret = process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Engagement events secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    schemes: ['madfam', 'legacy'],
    onEvent: async (payload) => {
      const engagementId = payload.engagement_id as string | undefined
      const type = payload.type as string | undefined
      if (!engagementId || !type) {
        logger.warn({ payload }, 'engagement artifact missing required fields')
        return
      }

      const db = getDb()
      const service = new EngagementsService({
        db,
        cache: new NoopCacheManager(),
        auth: {
          userId: 'service:cotiza',
          tenantId: 'madfam',
          roles: ['service'],
          scopes: ['engagements:write'],
          accessToken: '',
        },
        tenantId: 'madfam',
      })

      try {
        const artifact = await service.addArtifact({
          engagementId,
          type,
          entityType: payload.entity_type as string | undefined,
          entityId: payload.entity_id as string | undefined,
          url: payload.url as string | undefined,
          title: payload.title as string | undefined,
          metadata: (payload.metadata as Record<string, unknown> | undefined) ?? {},
        })
        logger.info(
          { engagementId, type, artifactId: artifact?.id },
          'engagement artifact recorded',
        )
      } catch (err) {
        logger.error({ err, engagementId, type }, 'engagement artifact failed')
        throw err
      }
    },
  })
}

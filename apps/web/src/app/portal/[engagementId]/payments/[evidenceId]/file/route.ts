import { readAndVerifyPortalSession } from '@/lib/portal/session'
import { getDb } from '@phynd/db'
import { paymentEvidence } from '@phynd/db/schema'
import { resolvePortalAccess } from '@phynd/services/engagement-portal/portal-access'
import { canViewEvidence } from '@phynd/services/payment-evidence/access'
import {
  EVIDENCE_URL_TTL_SECONDS,
  evidenceStorageFromEnv,
} from '@phynd/services/payment-evidence/storage'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

type RouteContext = {
  params: Promise<{ engagementId: string; evidenceId: string }>
}

// The client portal's view of a payment receipt. Checked on every request:
// a valid portal session for this engagement, a portal-enabled contact
// (resolvePortalAccess), and a receipt of THIS engagement that is
// client-visible and not voided. Then a redirect to a presigned URL that
// expires in EVIDENCE_URL_TTL_SECONDS. The bucket is never public.
export async function GET(req: Request, context: RouteContext) {
  const { engagementId, evidenceId } = await context.params
  const session = await readAndVerifyPortalSession()
  if (!session || session.engagementId !== engagementId) return notFound()

  const db = getDb()
  const access = await resolvePortalAccess(db, engagementId, session.email)
  if (access.status !== 'granted') return notFound()

  const [evidence] = await db
    .select({
      engagementId: paymentEvidence.engagementId,
      clientVisible: paymentEvidence.clientVisible,
      status: paymentEvidence.status,
      evidenceStorageKey: paymentEvidence.evidenceStorageKey,
      evidenceMime: paymentEvidence.evidenceMime,
    })
    .from(paymentEvidence)
    .where(eq(paymentEvidence.id, evidenceId))
    .limit(1)
  if (!evidence || !evidence.evidenceStorageKey) return notFound()
  if (!canViewEvidence({ kind: 'portal', engagementId }, evidence)) return notFound()

  const storage = evidenceStorageFromEnv()
  if (!storage) return notFound()
  const url = storage.presignGet(evidence.evidenceStorageKey, {
    expiresIn: EVIDENCE_URL_TTL_SECONDS,
    contentType: evidence.evidenceMime ?? undefined,
    inlineFilename: 'comprobante',
  })
  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}

// One answer for "not yours", "not visible" and "does not exist".
function notFound() {
  return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

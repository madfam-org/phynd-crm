import { PortalActivity, PortalFiles, PortalQuotes } from '@/components/portal/portal-commerce'
import { PortalItems } from '@/components/portal/portal-items'
import { labelFor, portalCopy, portalRegister } from '@/lib/portal/copy'
import { groupPortalItems } from '@/lib/portal/items'
import { buildQuoteCards, findPortalQuotes, loadAcceptedDeliverableIds } from '@/lib/portal/quotes'
import { readAndVerifyPortalSession } from '@/lib/portal/session'
import { getDb } from '@phynd/db'
import { NoopCacheManager } from '@phynd/federation'
import { EngagementItemsService, EngagementsService, resolvePortalAccess } from '@phynd/services'
import { notFound, redirect } from 'next/navigation'

// Server-rendered portal page. Gates on the phynd-portal-session cookie
// (set by /portal/verify after the Janua magic-link exchange) and checks on
// every request that the session email belongs to a portal-enabled contact of
// this engagement (its primary contact, or an engagement_contacts row with
// portal_access = true), so a stale or forged cookie, or a contact whose
// access was removed, can't open it.
//
// No tRPC here — we read from @phynd/db directly because the client has
// no Janua staff session and can't mint a protectedProcedure context.
//
// PRIVACY: the activity feed comes from getClientTimeline() — engagement
// events explicitly marked visibility='client', nothing else — and items from
// EngagementItemsService.listForClient() (client_visible only). Never call
// getTimeline() here: it merges internal events, the contact's activities and
// stage transitions for staff. A guard test (__tests__/portal-privacy.test.ts)
// fails if this directory reads the staff timeline, activities or notes.
//
// Copy is Spanish (es-MX) in the viewer's register: tú only when that contact
// chose tú (contacts.spanish_formality), usted otherwise.

type PageProps = {
  params: Promise<{ engagementId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const STATUS_TONES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100',
  paused: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
}
const DEFAULT_TONE = 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-200'

export default async function EngagementPortalPage({ params, searchParams }: PageProps) {
  const { engagementId } = await params
  const query = await searchParams
  const checkoutError = firstQueryValue(query?.checkout_error)
  const checkoutNotice = firstQueryValue(query?.checkout)
  const signoffNotice = firstQueryValue(query?.signoff)
  const signoffError = firstQueryValue(query?.signoff_error)
  const session = await readAndVerifyPortalSession()

  if (!session || session.engagementId !== engagementId) {
    redirect('/portal/expired?reason=no-session')
  }

  const db = getDb()
  const access = await resolvePortalAccess(db, engagementId, session.email)
  if (access.status === 'not_found') notFound()
  if (access.status === 'denied') redirect('/portal/expired?reason=email-mismatch')
  const { engagement, viewer } = access

  const copy = portalCopy(portalRegister(viewer.spanishFormality))
  const ctx = {
    db,
    cache: new NoopCacheManager(),
    auth: {
      userId: `portal:${session.januaUserId}`,
      tenantId: 'madfam',
      roles: ['portal'],
      scopes: ['engagements:read'],
      accessToken: session.accessToken,
    },
    tenantId: 'madfam',
  }
  const service = new EngagementsService(ctx)

  const [timeline, artifacts, items, portalQuotes, acceptedDeliverableIds] = await Promise.all([
    service.getClientTimeline(engagementId, 50),
    service.listArtifacts(engagementId),
    new EngagementItemsService(ctx).listForClient(engagementId),
    findPortalQuotes(db, engagement),
    loadAcceptedDeliverableIds(db, engagementId),
  ])
  const quoteCards = await buildQuoteCards(db, portalQuotes)

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950" lang="es-MX">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-10 border-b border-slate-200 pb-6 dark:border-slate-800">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {engagement.company ?? copy.projectFallback}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {engagement.projectName}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {copy.greeting(viewer.preferredName ?? viewer.name)}
          </p>
          <span
            className={`mt-3 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONES[engagement.status] ?? DEFAULT_TONE}`}
          >
            {labelFor(copy.engagementStatus, engagement.status)}
          </span>
        </header>

        {signoffNotice === 'accepted' && (
          <p className="mb-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            {copy.signoffAccepted}
          </p>
        )}
        {signoffError && (
          <p className="mb-6 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            {copy.signoffError}
          </p>
        )}

        <PortalItems copy={copy} groups={groupPortalItems(items)} />

        <PortalQuotes
          cards={quoteCards}
          checkoutError={checkoutError}
          checkoutNotice={checkoutNotice}
          copy={copy}
          engagementId={engagementId}
        />

        <PortalFiles
          acceptedIds={acceptedDeliverableIds}
          artifacts={artifacts}
          copy={copy}
          engagementId={engagementId}
        />

        <PortalActivity copy={copy} timeline={timeline} />
      </div>
    </main>
  )
}

function firstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

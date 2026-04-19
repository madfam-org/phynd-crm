import { readPortalSession } from '@/lib/portal/session'
import { getDb } from '@phyne/db'
import { contacts, engagements } from '@phyne/db/schema'
import { EngagementsService } from '@phyne/services'
import { and, eq, isNull } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'

// Server-rendered portal page. Gates on the phyne-portal-session cookie
// (set by /portal/verify after the Janua magic-link exchange) and
// double-checks that the session email matches the engagement's contact
// email so a stale/forged cookie can't access a different engagement.
//
// No tRPC here — we read from @phyne/db directly because the client has
// no Janua staff session and can't mint a protectedProcedure context.

type PageProps = {
  params: Promise<{ engagementId: string }>
}

export default async function EngagementPortalPage({ params }: PageProps) {
  const { engagementId } = await params
  const session = await readPortalSession()

  if (!session || session.engagementId !== engagementId) {
    redirect(`/portal/expired?reason=no-session`)
  }

  const db = getDb()
  const [row] = await db
    .select({
      engagement: engagements,
      contactEmail: contacts.email,
      contactName: contacts.name,
      contactCompany: contacts.company,
    })
    .from(engagements)
    .innerJoin(contacts, eq(engagements.contactId, contacts.id))
    .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
    .limit(1)

  if (!row) {
    notFound()
  }

  if (row.contactEmail?.toLowerCase().trim() !== session.email.toLowerCase().trim()) {
    redirect(`/portal/expired?reason=email-mismatch`)
  }

  const service = new EngagementsService({
    db,
    // biome-ignore lint/suspicious/noExplicitAny: portal page reads directly
    cache: {} as any,
    auth: {
      userId: `portal:${session.januaUserId}`,
      tenantId: 'madfam',
      roles: ['portal'],
      scopes: ['engagements:read'],
      accessToken: session.accessToken,
    },
    tenantId: 'madfam',
  })

  const [timeline, artifacts] = await Promise.all([
    service.getTimeline(engagementId, 50),
    service.listArtifacts(engagementId),
  ])

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-10 border-b border-slate-200 pb-6 dark:border-slate-800">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {row.contactCompany ?? 'Your MADFAM project'}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {row.engagement.projectName}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Hello {row.contactName ?? row.contactEmail}, here's the live status of your engagement.
          </p>
          <StatusBadge status={row.engagement.status} />
        </header>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Project files
          </h2>
          {artifacts.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No files yet. We'll update this page as proposals, invoices, and deliverables arrive.
            </p>
          ) : (
            <ul className="space-y-2">
              {artifacts.map((a) => (
                <li
                  key={a.id}
                  className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {a.title ?? formatArtifactType(a.type)}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatArtifactType(a.type)} · {a.createdAt.toLocaleDateString()}
                      </p>
                    </div>
                    {a.url && (
                      <a
                        className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
                        href={a.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Open
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Activity
          </h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No activity yet. Updates from our team will appear here as your project progresses.
            </p>
          ) : (
            <ol className="space-y-3">
              {timeline.map((entry) => (
                <li
                  key={entry.id}
                  className="flex gap-3 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                >
                  <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-900 dark:text-slate-100">
                      {timelineMessage(entry)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {entry.createdAt.toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  )
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ')
  const tone =
    status === 'active'
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100'
      : status === 'completed'
        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-200'
        : status === 'paused'
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
          : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-200'
  return (
    <span
      className={`mt-3 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${tone}`}
    >
      {label}
    </span>
  )
}

function formatArtifactType(type: string): string {
  const map: Record<string, string> = {
    quote: 'Quote',
    signed_proposal: 'Signed proposal',
    invoice: 'Invoice',
    deliverable: 'Deliverable',
    nft_receipt: 'NFT receipt',
  }
  return map[type] ?? type.replace(/_/g, ' ')
}

// biome-ignore lint/suspicious/noExplicitAny: discriminated union on entry.kind, cast for readability
function timelineMessage(entry: any): string {
  if (entry.kind === 'event') {
    return entry.message ?? `${entry.source}: ${entry.eventType}`
  }
  if (entry.kind === 'activity') {
    return entry.title
  }
  if (entry.kind === 'stage_transition') {
    return 'Status changed'
  }
  return 'Update'
}

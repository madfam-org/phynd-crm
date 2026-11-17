import { Building2, Mail, MessageCircle, Phone, ShieldAlert, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { mailtoHref, telHref, whatsappHref } from '../channel'
import { COPY } from '../copy'
import { DeadlineClock, MaskedText, ScoreParts } from '../queue/lead-queue-parts'
import { formatStaffDateTime } from '../sla'
import type { Workspace } from './lead-detail-header'

// The lead page's panels. Each says what is known and says plainly what is not.

export function Panel({
  title,
  children,
  id,
}: {
  title: string
  children: React.ReactNode
  id?: string
}) {
  const headingId = id ?? `panel-${title.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-border p-4">
      <h2 id={headingId} className="mb-3 text-[0.9375rem] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

const CONTEXT_LABELS: [keyof NonNullable<Workspace['lead']['attribution']>, string][] = [
  ['intent', 'Intención'],
  ['lead_type', 'Tipo'],
  ['ec_code', 'Estándar (EC)'],
  ['availability_status', 'Disponibilidad'],
  ['landing_page', 'Página'],
  ['utm_source', 'Fuente (UTM)'],
  ['utm_medium', 'Medio (UTM)'],
  ['utm_campaign', 'Campaña (UTM)'],
  ['referrer', 'Referente'],
  ['tenant', 'Cuenta de origen'],
  ['quote_number', 'Cotización'],
]

/** The prospect's own words, then the first-party context the feed sent (G1). */
export function MessagePanel({ workspace }: { workspace: Workspace }) {
  const attribution = workspace.lead.attribution
  const rows = attribution
    ? CONTEXT_LABELS.flatMap(([key, label]) => {
        const value = attribution[key]
        return typeof value === 'string' && value ? [[label, value] as const] : []
      })
    : []
  const interests = attribution?.interests ?? []
  const booking = attribution?.booking
  return (
    <Panel title={COPY.message}>
      {workspace.message ? (
        <blockquote className="max-w-[70ch] whitespace-pre-wrap rounded-md bg-muted px-4 py-3 text-sm leading-relaxed">
          <MaskedText value={workspace.message} />
        </blockquote>
      ) : (
        <p className="text-sm text-meta">El lead no dejó mensaje.</p>
      )}
      {(rows.length > 0 || interests.length > 0 || booking) && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-meta">{label}</dt>
              <dd className="truncate" title={value}>
                {value}
              </dd>
            </div>
          ))}
          {interests.length > 0 && (
            <div className="min-w-0">
              <dt className="text-xs text-meta">Intereses</dt>
              <dd>{interests.join(', ')}</dd>
            </div>
          )}
          {booking?.starts_at && (
            <div className="min-w-0">
              <dt className="text-xs text-meta">Reunión</dt>
              <dd>
                {[booking.event_type_name, booking.starts_at, booking.host_name]
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </div>
          )}
        </dl>
      )}
    </Panel>
  )
}

/** One-click channels: they open the user's own client; nothing is sent from here. */
export function ContactPanel({ workspace }: { workspace: Workspace }) {
  const contact = workspace.contact
  const links = [
    { href: mailtoHref(contact?.email), label: 'Correo', value: contact?.email, Icon: Mail },
    { href: telHref(contact?.phone), label: 'Llamar', value: contact?.phone, Icon: Phone },
    {
      href: whatsappHref(contact?.phone),
      label: 'WhatsApp',
      value: contact?.phone,
      Icon: MessageCircle,
    },
  ]
  return (
    <Panel title="Contacto">
      {contact ? (
        <ul className="space-y-2">
          {links.map(({ href, label, value, Icon }) => (
            <li key={label} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Icon aria-hidden className="h-4 w-4 shrink-0 text-meta" />
                {value ? (
                  <MaskedText value={value} className="truncate" />
                ) : (
                  <span className="text-meta">Sin dato</span>
                )}
              </span>
              {href && (
                <a
                  href={href}
                  {...(href.startsWith('https:')
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${label}: abre tu aplicación, no envía nada`}
                >
                  {label}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-meta">Este lead no tiene contacto vinculado.</p>
      )}
      {contact && (
        <Link
          href={`/clients/${contact.id}`}
          className="mt-3 inline-block text-xs text-meta underline-offset-2 hover:underline"
        >
          Ver ficha del contacto
        </Link>
      )}
    </Panel>
  )
}

export function TasksPanel({ workspace }: { workspace: Workspace }) {
  return (
    <Panel title="Tareas abiertas">
      {workspace.tasks.length === 0 ? (
        <p className="text-sm text-meta">Sin tareas abiertas.</p>
      ) : (
        <ul className="space-y-2">
          {workspace.tasks.map((task) => (
            <li key={task.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">{task.title}</span>
              {task.kind === 'first_contact' ? (
                <DeadlineClock task={task} />
              ) : task.dueAt ? (
                <span className="shrink-0 text-xs text-meta tabular-nums">
                  {formatStaffDateTime(task.dueAt)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function ScorePanel({ workspace }: { workspace: Workspace }) {
  return (
    <Panel title={COPY.score}>
      <ScoreParts breakdown={workspace.breakdown} />
      {workspace.scoreComputedAt && (
        <p className="mt-2 text-xs text-meta">
          Calculada {formatStaffDateTime(workspace.scoreComputedAt)}. Reglas en{' '}
          <Link href="/settings/scoring" className="underline underline-offset-2">
            Configuración › Puntuación
          </Link>
          .
        </p>
      )}
    </Panel>
  )
}

/** Company facts the CRM already holds; enrichment (E3) is not built yet and says so. */
export function CompanyPanel({ workspace }: { workspace: Workspace }) {
  const { company } = workspace
  return (
    <Panel title="Empresa">
      <div className="flex items-start gap-2 text-sm">
        <Building2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-meta" />
        <div className="min-w-0 space-y-0.5">
          {company.name ? (
            <MaskedText value={company.name} />
          ) : (
            <p className="text-meta">Sin nombre de empresa</p>
          )}
          {company.domain && <p className="text-xs text-meta">{company.domain}</p>}
          {company.freeMail && (
            <p className="text-xs text-meta">Correo personal (sin dominio de empresa)</p>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-meta">Sin datos de empresa todavía.</p>
    </Panel>
  )
}

/** Engagement from the CRM's own visitor sessions (E4). */
export function EngagementPanel({ workspace }: { workspace: Workspace }) {
  const { engagement } = workspace
  return (
    <Panel title="Interacción">
      {engagement.sessions === 0 ? (
        <p className="text-sm text-meta">Sin visitas registradas para este contacto.</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Visitas', engagement.sessions],
              ['Regresos', engagement.returnVisits],
              ['Páginas', engagement.totalPageViews],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted px-2 py-2">
                <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                <dt className="text-xs text-meta">{label}</dt>
              </div>
            ))}
          </dl>
          {engagement.pagesBefore.length > 0 && (
            <>
              <h3 className="mt-3 text-xs font-medium text-meta">Antes de convertir</h3>
              <ol className="mt-1 space-y-1 text-xs">
                {engagement.pagesBefore.map((view) => (
                  <li
                    key={`${view.url}-${String(view.viewedAt)}`}
                    className="truncate"
                    title={view.url}
                  >
                    {view.title || view.url}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </Panel>
  )
}

const CONSENT_STATUS: Record<string, string> = {
  granted: 'Otorgado',
  revoked: 'Revocado',
  pending_double_opt_in: 'Pendiente de confirmar',
}

export function ConsentPanel({ workspace }: { workspace: Workspace }) {
  const { consent, lead, contact } = workspace
  const blocked = lead.unsubscribed || consent.suppressed.length > 0
  const Icon = blocked ? ShieldAlert : ShieldCheck
  return (
    <Panel title="Consentimiento">
      <p className={`flex items-center gap-2 text-sm ${blocked ? 'text-danger-ink' : ''}`}>
        <Icon aria-hidden className="h-4 w-4" />
        {lead.unsubscribed
          ? 'Dado de baja: no enviar comunicaciones comerciales.'
          : consent.suppressed.length > 0
            ? 'En lista de supresión: no enviar.'
            : contact?.marketingConsent
              ? 'Aceptó comunicaciones comerciales.'
              : 'Sin consentimiento comercial registrado.'}
      </p>
      {(consent.records.length > 0 || consent.suppressed.length > 0) && (
        <ul className="mt-2 space-y-1 text-xs text-meta">
          {consent.records.map((record) => (
            <li key={`${record.channel}-${String(record.updatedAt)}`}>
              {record.channel}: {CONSENT_STATUS[record.status] ?? record.status}
            </li>
          ))}
          {consent.suppressed.map((entry) => (
            <li key={`${entry.channel}-${entry.reason}`}>
              Supresión ({entry.channel}): {entry.reason}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Possible duplicate contacts (same phone or same name): a hint, never a merge. */
export function DuplicatesHint({ workspace }: { workspace: Workspace }) {
  if (workspace.duplicates.length === 0) return null
  return (
    <Panel title="Posibles duplicados">
      <ul className="space-y-1 text-sm">
        {workspace.duplicates.map((dup) => (
          <li key={dup.id} className="flex justify-between gap-2">
            <Link
              href={`/clients/${dup.id}`}
              className="truncate underline-offset-2 hover:underline"
            >
              {dup.name}
            </Link>
            <span className="shrink-0 text-xs text-meta">
              {dup.reason === 'phone' ? 'mismo teléfono' : 'mismo nombre'}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

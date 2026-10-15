import { type PortalCopy, itemStatusLabel, labelFor } from '@/lib/portal/copy'
import { type ItemTone, type PortalItemGroups, itemDateLine, itemTone } from '@/lib/portal/items'
import type { ClientEngagementItem } from '@phynd/services'

// Server-rendered sections of the client portal for engagement items.
// Inputs are client-visible items only (EngagementItemsService.listForClient).

const TONE_CLASSES: Record<ItemTone, string> = {
  done: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100',
  active: 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100',
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

export function PortalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {children}
    </section>
  )
}

export function PortalEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500 dark:text-slate-400">{children}</p>
}

function ItemCard({ item, copy }: { item: ClientEngagementItem; copy: PortalCopy }) {
  const dateLine = itemDateLine(item, copy)
  return (
    <li className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {labelFor(copy.itemKind, item.kind)}
          </p>
          <p className="font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
          {item.description && (
            <p className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
              {item.description}
            </p>
          )}
          {dateLine && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{dateLine}</p>
          )}
          {item.artifactUrl && (
            <a
              className="mt-2 inline-block text-sm text-slate-900 underline dark:text-slate-100"
              href={item.artifactUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {item.artifactTitle ?? copy.linkedFile}
            </a>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 self-start rounded-full px-2 py-1 text-xs font-medium ${TONE_CLASSES[itemTone(item)]}`}
        >
          {itemStatusLabel(copy, item.status)}
        </span>
      </div>
    </li>
  )
}

function ItemList({ items, copy }: { items: ClientEngagementItem[]; copy: PortalCopy }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <ItemCard copy={copy} item={item} key={item.id} />
      ))}
    </ul>
  )
}

export function PortalItems({ groups, copy }: { groups: PortalItemGroups; copy: PortalCopy }) {
  const { actionables } = groups
  const hasActionables = actionables.madfam.length + actionables.client.length > 0
  return (
    <>
      <PortalSection title={copy.sections.progress}>
        {groups.progress.length === 0 ? (
          <PortalEmpty>{copy.progressEmpty}</PortalEmpty>
        ) : (
          <ItemList copy={copy} items={groups.progress} />
        )}
      </PortalSection>

      {hasActionables && (
        <PortalSection title={copy.sections.actionables}>
          <div className="grid gap-6 md:grid-cols-2">
            {[
              { label: copy.madfamSide, items: actionables.madfam },
              { label: copy.clientSide, items: actionables.client },
            ].map((side) => (
              <div key={side.label}>
                <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {side.label}
                </h3>
                {side.items.length === 0 ? (
                  <PortalEmpty>{copy.nothingPending}</PortalEmpty>
                ) : (
                  <ItemList copy={copy} items={side.items} />
                )}
              </div>
            ))}
          </div>
        </PortalSection>
      )}

      {groups.clientDecisions.length > 0 && (
        <PortalSection title={copy.decisionsTitle}>
          <ItemList copy={copy} items={groups.clientDecisions} />
        </PortalSection>
      )}
      {groups.madfamDecisions.length > 0 && (
        <PortalSection title={copy.sections.decisionsMadfam}>
          <ItemList copy={copy} items={groups.madfamDecisions} />
        </PortalSection>
      )}
      {groups.decidedDecisions.length > 0 && (
        <PortalSection title={copy.sections.decisionsDone}>
          <ItemList copy={copy} items={groups.decidedDecisions} />
        </PortalSection>
      )}
    </>
  )
}

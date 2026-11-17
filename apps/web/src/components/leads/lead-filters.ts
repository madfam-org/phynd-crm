// The `/leads` link filters: `?view=mine|tier_a|unassigned|overdue|all`,
// `?owner=me|unassigned|<userId>`, `?tier=A|B|C` and `?page=`. Parsed once on
// the server page and used by the view tabs and chips, so a copied URL opens
// the same view.

export const LEAD_TIER_FILTERS = ['A', 'B', 'C'] as const
export type LeadTierFilter = (typeof LEAD_TIER_FILTERS)[number]

export const LEAD_QUEUE_VIEWS = ['mine', 'tier_a', 'unassigned', 'overdue', 'all'] as const
export type LeadQueueView = (typeof LEAD_QUEUE_VIEWS)[number]

export interface LeadsFilters {
  view?: LeadQueueView
  /** `me`, `unassigned`, or a CRM user id. */
  owner?: string
  tier?: LeadTierFilter
  page?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** The filters a search-params object asks for; unknown values are ignored. */
export function parseLeadsFilters(
  params: Record<string, string | string[] | undefined>,
): LeadsFilters {
  const filters: LeadsFilters = {}
  const view = first(params.view)?.trim().toLowerCase()
  if (view && view !== 'all' && (LEAD_QUEUE_VIEWS as readonly string[]).includes(view)) {
    filters.view = view as LeadQueueView
  }
  const owner = first(params.owner)?.trim()
  if (owner === 'me' || owner === 'unassigned' || (owner && UUID.test(owner))) {
    filters.owner = owner
  }
  const tier = first(params.tier)?.trim().toUpperCase()
  if (tier && (LEAD_TIER_FILTERS as readonly string[]).includes(tier)) {
    filters.tier = tier as LeadTierFilter
  }
  const page = Number(first(params.page))
  if (Number.isInteger(page) && page > 1 && page <= 10_000) filters.page = page
  return filters
}

/** `/leads` with these filters, keys in a fixed order so links compare equal. */
export function leadsHref(filters: LeadsFilters): string {
  const params = new URLSearchParams()
  if (filters.view && filters.view !== 'all') params.set('view', filters.view)
  if (filters.owner) params.set('owner', filters.owner)
  if (filters.tier) params.set('tier', filters.tier)
  if (filters.page && filters.page > 1) params.set('page', String(filters.page))
  const query = params.toString()
  return query ? `/leads?${query}` : '/leads'
}

/**
 * The view tab a URL lands on. `?owner=me` alone is "My leads", `?owner=unassigned`
 * alone is "Unassigned" and `?tier=A` alone is "Tier A", so the owner's link
 * `?owner=me&tier=A` highlights "My leads" with the Tier A chip on.
 */
export function activeView(filters: LeadsFilters): LeadQueueView {
  if (filters.view) return filters.view
  if (filters.owner === 'me') return 'mine'
  if (filters.owner === 'unassigned') return 'unassigned'
  if (filters.tier === 'A' && !filters.owner) return 'tier_a'
  return 'all'
}

/** The `leads.queue` input for a URL's filters (the view's own owner/tier win). */
export function queueInput(filters: LeadsFilters): {
  view: LeadQueueView
  owner?: string
  tier?: LeadTierFilter
  page?: number
} {
  const view = activeView(filters)
  const input: ReturnType<typeof queueInput> = { view }
  if (filters.owner && view !== 'mine' && view !== 'unassigned') input.owner = filters.owner
  if (filters.tier && view !== 'tier_a') input.tier = filters.tier
  if (filters.page) input.page = filters.page
  return input
}

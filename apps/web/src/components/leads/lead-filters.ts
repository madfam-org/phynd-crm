// The `/leads` link filters: `?owner=me|unassigned|<userId>` and `?tier=A|B|C`.
// Parsed once on the server page and used by the filter chips, so a copied URL
// opens the same view.

export const LEAD_TIER_FILTERS = ['A', 'B', 'C'] as const
export type LeadTierFilter = (typeof LEAD_TIER_FILTERS)[number]

export interface LeadsFilters {
  /** `me`, `unassigned`, or a CRM user id. */
  owner?: string
  tier?: LeadTierFilter
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
  const owner = first(params.owner)?.trim()
  if (owner === 'me' || owner === 'unassigned' || (owner && UUID.test(owner))) {
    filters.owner = owner
  }
  const tier = first(params.tier)?.trim().toUpperCase()
  if (tier && (LEAD_TIER_FILTERS as readonly string[]).includes(tier)) {
    filters.tier = tier as LeadTierFilter
  }
  return filters
}

/** `/leads` with these filters, keys in a fixed order so links compare equal. */
export function leadsHref(filters: LeadsFilters): string {
  const params = new URLSearchParams()
  if (filters.owner) params.set('owner', filters.owner)
  if (filters.tier) params.set('tier', filters.tier)
  const query = params.toString()
  return query ? `/leads?${query}` : '/leads'
}

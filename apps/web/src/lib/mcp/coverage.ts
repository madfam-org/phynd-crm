import { MCP_TOOL_NAMES } from './tools'

/**
 * The native MCP's COVERAGE CONTRACT: every operation the CRM offers its own
 * UI (every tRPC procedure of `appRouter`, each a thin call into
 * `@phynd/services`) is COVERED by a tool that runs the same service method,
 * or EXEMPTED with a reason. `__tests__/coverage.guard.test.ts` walks the real
 * router and fails CI when a procedure has no entry, when an entry names no
 * procedure, when a tool covers nothing, or when a mutation is marked covered.
 *
 * Keys are `<router>.<procedure>`, or `<router>.*` for a router exempted as a
 * whole. An exact key wins over its router's wildcard; a router with a covered
 * procedure lists every procedure exactly (no wildcard).
 *
 * This slice is READ-ONLY. Exempt by decision, whatever the router:
 *   - every write (create, update, delete, move, bulk change, complete);
 *   - campaign sending and its authorization;
 *   - consent and suppression, reads included.
 *
 * Outside tRPC, and not agent reads: the signed machine ingests under
 * `/api/v1/*` and `/api/webhooks/*` (each has its own HMAC contract and raw
 * payload store, which no tool returns), the convergence feed (its own token,
 * `docs/CONVERGENCE_API.md`), GraphQL (the legacy Selva surface) and the
 * client portal (people, by magic link).
 */

export interface CoveredProcedure {
  /** The tools that ARE this read. */
  readonly tools: readonly string[]
  /**
   * The service method the procedure calls. The tools call the same method,
   * except where a comment on the entry names the variant they call.
   */
  readonly service: string
}

export interface ExemptProcedure {
  readonly exempt: string
}

export type ProcedureCoverage = CoveredProcedure | ExemptProcedure

export function isCovered(entry: ProcedureCoverage): entry is CoveredProcedure {
  return 'tools' in entry
}

const WRITE = 'write: this slice is read-only; writes stay with staff in the UI'
const PER_USER =
  'per-user view of a signed-in staff member; a machine client is no CRM user (filter by owner_id instead)'
const NEXT_SLICE = 'read not in the first slice (contacts, leads, open tasks, deals by stage)'
const CONSENT =
  'consent and suppression: the ledger, its audit trail and every change to them stay out of agent reach in this slice'
const CAMPAIGN_SEND =
  'campaigns: drafting, importing, authorizing and sending are human decisions behind send gates; exempt in this slice, reads included'
const MONEY =
  'commercial and payment records (amounts, receipts, bank details): not a pipeline read'
const STAFF_DIRECTORY = 'staff directory and access administration (admin-gated): names staff'
const CASES =
  'cases (requests with a deadline): no MCP tool yet by owner ruling; a later slice decides'
const ANALYTICS = 'aggregates for the dashboard; a later slice can add them as their own tools'
const TRACKING =
  'visitor sessions and page views: behavioural data about people, not a pipeline read'
const FEDERATION =
  'federated profile assembled live from other platforms: those platforms expose their own MCP'

export const MCP_COVERAGE: Readonly<Record<string, ProcedureCoverage>> = {
  // ── contacts ──────────────────────────────────────────────────────────────
  'contacts.list': {
    tools: [MCP_TOOL_NAMES.contactsSearch],
    service: 'ContactsService.list',
  },
  'contacts.getById': {
    tools: [MCP_TOOL_NAMES.contactsGet],
    service: 'ContactsService.getDetail',
  },
  'contacts.listMine': { exempt: PER_USER },
  'contacts.create': { exempt: WRITE },
  'contacts.bulkCreate': { exempt: WRITE },
  'contacts.update': { exempt: WRITE },
  'contacts.delete': { exempt: WRITE },

  // ── leads ─────────────────────────────────────────────────────────────────
  'leads.list': { tools: [MCP_TOOL_NAMES.leadsList], service: 'LeadsService.list' },
  'leads.listMine': { exempt: PER_USER },
  'leads.listByContactId': { exempt: NEXT_SLICE },
  'leads.getById': { exempt: NEXT_SLICE },
  'leads.create': { exempt: WRITE },
  'leads.update': { exempt: WRITE },
  'leads.moveToStage': { exempt: WRITE },
  'leads.bulkUpdateStatus': { exempt: WRITE },
  'leads.delete': { exempt: WRITE },

  // ── activities (tasks) ────────────────────────────────────────────────────
  // tasks_list_open calls the same listRecent, narrowed to open tasks (type
  // task, status pending) whose parent record is not soft-deleted, and pages
  // the same way: newest first by (created_at, id), the cursor being the id
  // of the previous page's last row.
  'activities.list': {
    tools: [MCP_TOOL_NAMES.tasksListOpen],
    service: 'ActivitiesService.listRecent',
  },
  // The UI's procedure calls listForEntity (every activity, oldest first);
  // contacts_get calls listRecentForEntity: the same entity filter, newest
  // first, capped at activity_limit.
  'activities.listForEntity': {
    tools: [MCP_TOOL_NAMES.contactsGet],
    service: 'ActivitiesService.listForEntity',
  },
  'activities.listMine': { exempt: PER_USER },
  'activities.create': { exempt: WRITE },
  'activities.update': { exempt: WRITE },
  'activities.delete': { exempt: WRITE },
  'activities.complete': { exempt: WRITE },

  // ── cases ─────────────────────────────────────────────────────────────────
  'cases.list': { exempt: CASES },
  'cases.getById': { exempt: CASES },
  'cases.create': { exempt: WRITE },
  'cases.update': { exempt: WRITE },

  // ── opportunities (deals) ─────────────────────────────────────────────────
  'opportunities.list': {
    tools: [MCP_TOOL_NAMES.dealsList],
    service: 'OpportunitiesService.list',
  },
  'opportunities.listMine': { exempt: PER_USER },
  'opportunities.listByContactId': { exempt: NEXT_SLICE },
  'opportunities.getById': { exempt: NEXT_SLICE },
  'opportunities.create': { exempt: WRITE },
  'opportunities.update': { exempt: WRITE },
  'opportunities.moveToStage': { exempt: WRITE },
  'opportunities.bulkUpdateStatus': { exempt: WRITE },
  'opportunities.delete': { exempt: WRITE },

  // ── pipelines ─────────────────────────────────────────────────────────────
  'pipelines.list': {
    tools: [MCP_TOOL_NAMES.pipelinesList],
    service: 'PipelinesService.list',
  },
  'pipelines.getStages': {
    tools: [MCP_TOOL_NAMES.pipelinesList],
    service: 'PipelinesService.getStages',
  },
  'pipelines.getById': { exempt: 'pipelines_list already returns every pipeline' },
  'pipelines.getDefault': { exempt: 'pipelines_list marks the default pipeline (is_default)' },
  'pipelines.create': { exempt: WRITE },
  'pipelines.update': { exempt: WRITE },
  'pipelines.delete': { exempt: WRITE },
  'pipelines.createStage': { exempt: WRITE },
  'pipelines.updateStage': { exempt: WRITE },
  'pipelines.deleteStage': { exempt: WRITE },
  'pipelines.reorderStages': { exempt: WRITE },

  // ── whole routers, exempt ─────────────────────────────────────────────────
  'consent.*': { exempt: CONSENT },
  'campaigns.*': { exempt: CAMPAIGN_SEND },
  'campaignAuthorizations.*': { exempt: CAMPAIGN_SEND },
  'offers.*': { exempt: CAMPAIGN_SEND },
  'referrals.*': { exempt: CAMPAIGN_SEND },
  'aiKanban.*': {
    exempt:
      'AI suggestions awaiting a staff decision (human-in-the-loop queue), behind its own flag',
  },
  'analytics.*': { exempt: ANALYTICS },
  'conversions.*': { exempt: ANALYTICS },
  'leadScoring.*': {
    exempt: `scoring rules and recomputation; a lead's score is already on leads_list. ${NEXT_SLICE}`,
  },
  'engagements.*': {
    exempt:
      'client engagements have their own machine scope (phynd-crm-engagements:read) over tRPC',
  },
  'engagementItems.*': { exempt: 'client engagements: see engagements.*' },
  'engagementContacts.*': { exempt: 'client engagements: see engagements.*' },
  'paymentEvidence.*': { exempt: MONEY },
  'quotes.*': { exempt: MONEY },
  'orders.*': { exempt: MONEY },
  'grants.*': { exempt: 'grant applications and their approval queue: not the sales pipeline' },
  'federationHealth.*': { exempt: 'infrastructure probe of the upstream providers' },
  'unifiedProfile.*': { exempt: FEDERATION },
  'visitorTracking.*': { exempt: TRACKING },
  'notes.*': {
    exempt: `free text written by staff about people; ${NEXT_SLICE}, and it needs its own review before it leaves`,
  },
  'tags.*': { exempt: NEXT_SLICE },
  'timeline.*': {
    exempt:
      'merges notes and stage moves into the activity feed; contacts_get returns the activities',
  },
  'search.*': {
    exempt: 'cross-entity search for the staff search box; contacts_search is the contact search',
  },
  'notifications.*': { exempt: PER_USER },
  'preferences.*': { exempt: 'dashboard layout preferences per staff role' },
  'users.*': { exempt: STAFF_DIRECTORY },
}

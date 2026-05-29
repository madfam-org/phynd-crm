#!/usr/bin/env node
/**
 * WS6.7 — Selva office integration smoke test.
 *
 * Exercises the service-token read workflow against a running Phynd CRM instance:
 * search → contact → opportunities → unified profile → federation health.
 * Also verifies write scope is denied for lead creation (least-privilege).
 *
 * Usage:
 *   FEDERATION_API_TOKEN=... node scripts/verify-selva-agent-integration.mjs
 *   FEDERATION_API_TOKEN=... CRM_BASE_URL=https://staging-phynd.app node scripts/verify-selva-agent-integration.mjs --json
 *   node scripts/verify-selva-agent-integration.mjs --dry-run
 */

const DEFAULT_BASE_URL = 'http://localhost:3000'
const DEFAULT_SEARCH_QUERY = 'tablaco'

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json'),
    withAiKanban: argv.includes('--with-ai-kanban'),
  }
}

function fail(message) {
  const err = new Error(message)
  err.isCheckFailure = true
  throw err
}

function trpcInput(payload) {
  return JSON.stringify({ json: payload })
}

async function trpcQuery(baseUrl, token, path, input) {
  const url = new URL(`/api/trpc/${path}`, baseUrl)
  url.searchParams.set('input', trpcInput(input))
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await response.json().catch(() => null)
  return { response, body, path }
}

async function trpcMutation(baseUrl, token, path, input) {
  const url = new URL(`/api/trpc/${path}`, baseUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: trpcInput(input),
  })
  const body = await response.json().catch(() => null)
  return { response, body, path }
}

function unwrapTrpcData(body) {
  const data = body?.result?.data?.json ?? body?.result?.data
  if (data !== undefined) {
    return data
  }
  const error = body?.error?.json ?? body?.error
  if (error) {
    fail(`tRPC error: ${error.message ?? JSON.stringify(error)}`)
  }
  fail(`Unexpected tRPC response: ${JSON.stringify(body).slice(0, 240)}`)
}

function expectTrpcForbidden(body) {
  const code = body?.error?.json?.data?.code ?? body?.error?.data?.code ?? body?.error?.code
  if (code !== 'FORBIDDEN') {
    fail(`Expected FORBIDDEN, got: ${JSON.stringify(body).slice(0, 240)}`)
  }
}

function summarizeFederationStatus(profile) {
  const status = profile?.federationStatus
  if (!status || typeof status !== 'object') {
    return { available: 0, unavailable: 0, total: 0 }
  }
  const values = Object.values(status)
  return {
    available: values.filter((v) => v === 'ok' || v === 'cached').length,
    unavailable: values.filter((v) => v === 'unavailable' || v === 'error').length,
    total: values.length,
  }
}

async function runChecks(options) {
  const baseUrl = (process.env.CRM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const token = process.env.FEDERATION_API_TOKEN ?? ''
  const searchQuery = process.env.SELVA_SEARCH_QUERY ?? DEFAULT_SEARCH_QUERY

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      baseUrl,
      searchQuery,
      steps: [
        'search.search',
        'contacts.getById',
        'opportunities.listByContactId',
        'unifiedProfile.getProfile',
        'federationHealth.status',
        'leads.create (expect FORBIDDEN)',
      ],
    }
  }

  if (!token) {
    fail('FEDERATION_API_TOKEN is required (or pass --dry-run)')
  }

  const results = []

  const searchResult = await trpcQuery(baseUrl, token, 'search.search', {
    query: searchQuery,
    limit: 5,
  })
  if (!searchResult.response.ok) {
    fail(`search.search HTTP ${searchResult.response.status}`)
  }
  const searchData = unwrapTrpcData(searchResult.body)
  const hits = Array.isArray(searchData) ? searchData : []
  const contactHit = hits.find((item) => item.entityType === 'contact')
  if (!contactHit?.id) {
    fail(`search.search returned no contacts for query "${searchQuery}" — seed DB or adjust SELVA_SEARCH_QUERY`)
  }
  results.push({ step: 'search.search', contactId: contactHit.id })

  const contactResult = await trpcQuery(baseUrl, token, 'contacts.getById', { id: contactHit.id })
  if (!contactResult.response.ok) {
    fail(`contacts.getById HTTP ${contactResult.response.status}`)
  }
  const contact = unwrapTrpcData(contactResult.body)
  results.push({ step: 'contacts.getById', name: contact.name, email: contact.email })

  const oppsResult = await trpcQuery(baseUrl, token, 'opportunities.listByContactId', {
    contactId: contactHit.id,
  })
  if (!oppsResult.response.ok) {
    fail(`opportunities.listByContactId HTTP ${oppsResult.response.status}`)
  }
  const opps = unwrapTrpcData(oppsResult.body)
  const opportunity = Array.isArray(opps?.items) ? opps.items[0] : Array.isArray(opps) ? opps[0] : null
  results.push({
    step: 'opportunities.listByContactId',
    count: Array.isArray(opps?.items) ? opps.items.length : Array.isArray(opps) ? opps.length : 0,
    opportunityId: opportunity?.id ?? null,
  })

  const profileResult = await trpcQuery(baseUrl, token, 'unifiedProfile.getProfile', {
    contactId: contactHit.id,
  })
  if (!profileResult.response.ok) {
    fail(`unifiedProfile.getProfile HTTP ${profileResult.response.status}`)
  }
  const profile = unwrapTrpcData(profileResult.body)
  const federationSummary = summarizeFederationStatus(profile)
  results.push({ step: 'unifiedProfile.getProfile', federationSummary })

  const healthResult = await trpcQuery(baseUrl, token, 'federationHealth.status', {})
  if (!healthResult.response.ok) {
    fail(`federationHealth.status HTTP ${healthResult.response.status}`)
  }
  unwrapTrpcData(healthResult.body)
  results.push({ step: 'federationHealth.status', ok: true })

  const deniedResult = await trpcMutation(baseUrl, token, 'leads.create', {
    title: 'Selva integration probe — should be forbidden',
    contactId: contactHit.id,
    pipelineId: '00000000-0000-0000-0000-000000000001',
    stageId: '00000000-0000-0000-0000-000000000002',
  })
  expectTrpcForbidden(deniedResult.body)
  results.push({ step: 'leads.create', denied: true })

  if (options.withAiKanban && opportunity?.id && opportunity?.stageId) {
    const suggestionResult = await trpcMutation(baseUrl, token, 'aiKanban.createSuggestion', {
      entityType: 'opportunity',
      entityId: opportunity.id,
      suggestionType: 'move_stage',
      title: 'Selva integration probe — stage review',
      rationale: 'Automated WS6.7 probe',
      proposedStageId: opportunity.stageId,
    })
    if (suggestionResult.response.ok) {
      const suggestion = unwrapTrpcData(suggestionResult.body)
      results.push({ step: 'aiKanban.createSuggestion', suggestionId: suggestion.id })
    } else {
      const message =
        suggestionResult.body?.error?.json?.message ??
        suggestionResult.body?.error?.message ??
        `HTTP ${suggestionResult.response.status}`
      results.push({ step: 'aiKanban.createSuggestion', skipped: true, reason: message })
    }
  }

  return {
    ok: true,
    baseUrl,
    searchQuery,
    contactId: contactHit.id,
    servicePrincipal: 'service:selva',
    results,
    recommendation: opportunity
      ? `Review opportunity ${opportunity.id} (${opportunity.title ?? 'untitled'}) for ${contact.name}`
      : `Review contact ${contact.name} — no open opportunities in CRM`,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  try {
    const payload = await runChecks(options)
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2))
    } else {
      console.log('PASS verify-selva-agent-integration')
      if (payload.dryRun) {
        console.log(`  dry-run against ${payload.baseUrl}`)
        for (const step of payload.steps) {
          console.log(`  - ${step}`)
        }
      } else {
        console.log(`  baseUrl: ${payload.baseUrl}`)
        console.log(`  contact: ${payload.contactId}`)
        console.log(`  next: ${payload.recommendation}`)
        const profileStep = payload.results.find((r) => r.step === 'unifiedProfile.getProfile')
        if (profileStep?.federationSummary) {
          console.log(
            `  federation: ${profileStep.federationSummary.available}/${profileStep.federationSummary.total} providers available`,
          )
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2))
    } else {
      console.error('FAIL verify-selva-agent-integration')
      console.error(`  ${message}`)
    }
    process.exit(1)
  }
}

main()

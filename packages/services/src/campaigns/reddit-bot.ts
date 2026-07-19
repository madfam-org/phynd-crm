import { campaigns } from '@phynd/db/schema'
import { eq } from 'drizzle-orm'
import OpenAI from 'openai'
import { ContactsService } from '../contacts/contacts.service'
import type { ServiceContext } from '../context'
import { LeadsService } from '../leads/leads.service'
import { PipelinesService } from '../pipelines/pipelines.service'
import { CampaignsService } from './campaigns.service'

/**
 * Owned social-identity profile Fortuna selects for a signal. `handle` is the
 * account that authors the reply; `platform` selects which owned identity
 * posts. This is attribution/identity metadata only — it never gates the
 * consent-gated email send path.
 */
export interface FortunaBotProfile {
  platform?: string
  handle?: string
  display_name?: string
  tone?: string
  sku_affinity?: string
}

export interface BotCampaignPayload {
  campaign_type: string
  bot_identity: string
  outreach_target: {
    url: string
    author: string
    original_post_content: string
  }
  legal_context: {
    distress_sentiment: string
    core_legal_problem: string
    domain: string
  }
  orchestration: {
    instruction: string
  }
  /**
   * Master join key threading a Fortuna signal → phynd campaign → captured
   * consent → conversion. Format `sig_{source_slug}_{sha256(source:title)[:12]}`.
   * Attribution/metadata ONLY — mirrors the proven `fortuna_grant_id` grant path.
   */
  fortuna_signal_id?: string
  /** Owned social identity Fortuna selected for this outreach. */
  profile?: FortunaBotProfile
}

/**
 * Build the attribution metadata bag persisted on the reddit_bot campaign's
 * existing `tulanaMetadata` jsonb (zero-migration). Threads the Fortuna master
 * join key (`fortuna_signal_id`) plus the selected posting profile through the
 * campaign so per-signal attribution can resolve later.
 *
 * `utm_content` mirrors `fortuna_signal_id` as the signal-level attribution key
 * (utm_campaign stays the campaign/legal-domain resolver). This is metadata
 * only: reddit_bot campaigns carry no `skuKey`, so they never enter the
 * consent-gated Tulana send path — the join key never influences the consent
 * gate decision.
 *
 * Returns null when the payload carries neither the join key nor a profile, so
 * the caller can skip the extra write for legacy Reddit-shaped payloads.
 */
export function buildFortunaAttributionMetadata(
  payload: Pick<BotCampaignPayload, 'fortuna_signal_id' | 'profile'>,
): Record<string, unknown> | null {
  if (!payload.fortuna_signal_id && !payload.profile) {
    return null
  }
  const metadata: Record<string, unknown> = { source: 'fortuna' }
  if (payload.fortuna_signal_id) {
    metadata.fortuna_signal_id = payload.fortuna_signal_id
    metadata.utm_content = payload.fortuna_signal_id
  }
  if (payload.profile) {
    metadata.profile = payload.profile
  }
  return metadata
}

export interface TezcaArticleHit {
  law_title?: string
  number?: string
  id?: string
  text?: string
}

export interface TezcaJudicialHit {
  registro?: string
  rubro?: string
  text?: string
  materia?: string
}

interface TezcaArticleResponse {
  results?: TezcaArticleHit[]
}

interface TezcaJudicialResponse {
  results?: TezcaJudicialHit[]
}

/**
 * Map legal domain labels to Tezca's materia taxonomy.
 *
 * Tezca's judicial search endpoint filters by `materia` — this maps
 * human-readable domain names from the bot payload to the API values.
 */
export function mapDomainToMateria(domain: string): string {
  const normalized = domain.toLowerCase().trim()
  const mapping: Record<string, string> = {
    labor: 'laboral',
    laboral: 'laboral',
    employment: 'laboral',
    tax: 'administrativa',
    fiscal: 'administrativa',
    administrative: 'administrativa',
    administrativa: 'administrativa',
    criminal: 'penal',
    penal: 'penal',
    civil: 'civil',
    family: 'civil',
    familiar: 'civil',
    commercial: 'civil',
    mercantil: 'civil',
    constitutional: 'constitucional',
    constitucional: 'constitucional',
    amparo: 'constitucional',
  }
  return mapping[normalized] ?? 'civil'
}

export class RedditBotService {
  private openai: OpenAI
  private campaignsService: CampaignsService
  private contactsService: ContactsService
  private leadsService: LeadsService
  private pipelinesService: PipelinesService

  constructor(private readonly ctx: ServiceContext) {
    // Ecosystem policy: every LLM call routes through the Selva inference
    // gateway (OpenAI-compatible /v1). Fail closed rather than defaulting the
    // OpenAI SDK to api.openai.com when the gateway URL is not configured.
    const inferenceBaseUrl = process.env.OPENAI_BASE_URL
    if (!inferenceBaseUrl) {
      throw new Error(
        'OPENAI_BASE_URL must point at the Selva inference gateway; refusing to fall back to api.openai.com (ecosystem inference policy)',
      )
    }
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: inferenceBaseUrl,
    })
    this.campaignsService = new CampaignsService(ctx)
    this.contactsService = new ContactsService(ctx)
    this.leadsService = new LeadsService(ctx)
    this.pipelinesService = new PipelinesService(ctx)
  }

  async processWebhook(payload: BotCampaignPayload) {
    console.log(`Starting Reddit Bot routine for: ${payload.outreach_target.url}`)

    // Step 1: Query Tezca for statutory articles
    const legalTextContext = await this.queryTezcaArticles(payload.legal_context.core_legal_problem)

    // Step 2: Query Tezca for judicial precedent (tesis / jurisprudencia)
    const materia = mapDomainToMateria(payload.legal_context.domain)
    const judicialContext = await this.queryTezcaJudicial(
      payload.legal_context.core_legal_problem,
      materia,
    )

    // Step 3: Merge article + judicial context for the LLM
    const mergedContext = this.mergeTezcaContext(legalTextContext, judicialContext)

    // Step 4: Use LLM to synthesize response
    const draftResponse = await this.draftResponse(payload, mergedContext)

    // Step 5: Upsert contact and create lead in CRM
    const { contactId } = await this.upsertContactAndLead(payload)

    // Step 6: Log locally as "DRAFT" in CRM (Human-in-the-loop safety protocol)
    const campaignId = await this.logToCRM(payload, draftResponse, mergedContext, contactId)

    console.log(`Campaign successfully staged for review! ID: ${campaignId}`)
    return { status: 'success', draft_stage_id: campaignId, contactId }
  }

  /**
   * Query Tezca for statutory articles matching the legal problem.
   */
  private async queryTezcaArticles(query: string): Promise<string> {
    const tezcaUrl = process.env.TEZCA_API_URL ?? 'http://tezca:8000'
    const encodedQuery = encodeURIComponent(query)
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `ApiKey ${process.env.INTERNAL_TEZCA_KEY ?? 'test-key'}`,
    }

    // Try semantic search first, fall back to keyword search
    for (const endpoint of [
      `${tezcaUrl}/api/v1/search/semantic/?q=${encodedQuery}&limit=3`,
      `${tezcaUrl}/api/v1/search/articles/?q=${encodedQuery}`,
    ]) {
      try {
        const res = await fetch(endpoint, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(8000),
        })

        if (!res.ok) continue

        const data = (await res.json()) as TezcaArticleResponse

        if (data.results && data.results.length > 0) {
          const topHits = data.results
            .slice(0, 3)
            .map(
              (hit) =>
                `Source: ${hit.law_title ?? 'Ley'}, Art: ${hit.number ?? hit.id ?? '?'}\nContext: ${(hit.text ?? '').slice(0, 500)}`,
            )
            .join('\n\n')
          return topHits
        }
      } catch {
        // Try next endpoint
      }
    }

    return 'No specific articles found. Consult general framework.'
  }

  /**
   * Query Tezca judicial search for relevant tesis / jurisprudencia.
   *
   * Calls `GET /api/v1/judicial/search/?q={query}&materia={materia}` on TEZCA_API_URL.
   * Returns the top 2 hits formatted with registro + rubro.
   */
  async queryTezcaJudicial(query: string, materia: string): Promise<string> {
    const tezcaUrl = process.env.TEZCA_API_URL ?? 'http://tezca:8000'
    try {
      const params = new URLSearchParams({ q: query, materia })
      const res = await fetch(`${tezcaUrl}/api/v1/judicial/search/?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `ApiKey ${process.env.INTERNAL_TEZCA_KEY ?? 'test-key'}`,
        },
        signal: AbortSignal.timeout(8000),
      })

      if (!res.ok) {
        console.error(`Tezca judicial returned ${res.status}`)
        return 'Judicial precedent unavailable.'
      }

      const data = (await res.json()) as TezcaJudicialResponse

      if (data.results && data.results.length > 0) {
        const topHits = data.results
          .slice(0, 2)
          .map(
            (hit) =>
              `Registro: ${hit.registro ?? 'N/A'}\nRubro: ${hit.rubro ?? 'Sin rubro'}\nExtracto: ${(hit.text ?? '').slice(0, 400)}`,
          )
          .join('\n\n')
        return topHits
      }

      return 'No judicial precedent found for this materia.'
    } catch (e) {
      console.error('Tezca judicial search failed: ', e)
      return 'Judicial oracle offline.'
    }
  }

  /**
   * Merge article context and judicial context into a single block for the LLM prompt.
   */
  private mergeTezcaContext(articleContext: string, judicialContext: string): string {
    return `--- Statutory Articles ---\n${articleContext}\n\n--- Judicial Precedent (Tesis/Jurisprudencia) ---\n${judicialContext}`
  }

  /**
   * Upsert a Contact by Reddit username (`u/{author}`) and create a Lead
   * linked to the default sales pipeline.
   *
   * Contact lookup is by name (the Reddit username). If already exists, reuse.
   * A new lead is always created per webhook (each Reddit post = new lead).
   */
  private async upsertContactAndLead(
    payload: BotCampaignPayload,
  ): Promise<{ contactId: string; leadId: string }> {
    const authorName = `u/${payload.outreach_target.author}`

    // Upsert contact by name
    let contact = await this.contactsService.getByName(authorName)
    if (!contact) {
      contact = await this.contactsService.create({
        name: authorName,
        company: 'Reddit',
      })
    }

    // Get default pipeline + first stage for the new lead
    const defaultPipeline = await this.pipelinesService.getDefault()
    if (!defaultPipeline) {
      throw new Error('No default pipeline configured — cannot create lead')
    }

    const stages = await this.pipelinesService.getStages(defaultPipeline.id)
    const firstStage = stages[0]
    if (!firstStage) {
      throw new Error('Default pipeline has no stages — cannot create lead')
    }

    // Create lead linked to the contact
    const lead = await this.leadsService.create({
      contactId: contact.id,
      source: 'reddit_bot',
      pipelineId: defaultPipeline.id,
      stageId: firstStage.id,
    })

    return { contactId: contact.id, leadId: lead.id }
  }

  private async draftResponse(payload: BotCampaignPayload, legalContext: string): Promise<string> {
    // Prefer the Fortuna-selected owned identity (profile.handle) for the reply
    // author; fall back to the payload's bot_identity for legacy Reddit-shaped
    // payloads that carry no profile.
    const botIdentity = payload.profile?.handle ?? payload.bot_identity
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: `You are ${botIdentity}, an automated legal outreach assistant operating on Reddit.
You provide completely rigorous, highly polite, and highly accurate Mexican Legal Context.
Do not guess. Use ONLY the extracted legal articles and judicial precedent provided in the context below.
Advise the user to seek official counsel always.
Always end your response with:
\n---\nConsulta la ley completa: https://tezca.mx/bienvenida?utm_source=reddit&utm_medium=social&utm_campaign=${payload.legal_context.domain}`,
          },
          {
            role: 'user',
            content: `Original Post by ${payload.outreach_target.author}:\n"${payload.outreach_target.original_post_content}"\n\nIdentified Problem: ${payload.legal_context.core_legal_problem}\n\nTezca Legal Context:\n${legalContext}\n\nDraft the markdown response:`,
          },
        ],
        temperature: 0.1,
      })

      return response.choices[0]?.message?.content ?? 'Drafting Error'
    } catch (e) {
      console.error('OpenAI mapping failed:', e)
      return 'LLM integration failed.'
    }
  }

  private async logToCRM(
    payload: BotCampaignPayload,
    draftResponse: string,
    tezcaContext: string,
    contactId?: string,
  ) {
    const campaign = await this.campaignsService.create({
      name: `Reddit Sync: u/${payload.outreach_target.author} - ${payload.legal_context.domain}`,
      description: `DRAFT PENDING APPROVAL:\n\n${draftResponse}\n\n---\nTezca Evidence:\n${tezcaContext}${contactId ? `\n\n---\nCRM Contact: ${contactId}` : ''}`,
      channel: 'reddit_bot',
      status: 'draft',
      // Store the Reddit post URL in utmSource for retrieval at approval time
      utmSource: payload.outreach_target.url,
      utmMedium: 'reddit',
      // utmCampaign stays the legal-domain resolver (coarse campaign bucket).
      utmCampaign: payload.legal_context.domain,
    })

    // Thread the Fortuna master join key + selected posting profile through the
    // campaign's existing jsonb metadata (zero-migration). Skipped entirely for
    // legacy Reddit-shaped payloads that carry no join key/profile. This is
    // attribution metadata only and never touches the consent gate.
    const attributionMetadata = buildFortunaAttributionMetadata(payload)
    if (attributionMetadata) {
      await this.ctx.db
        .update(campaigns)
        .set({ tulanaMetadata: attributionMetadata })
        .where(eq(campaigns.id, campaign.id))
    }

    return campaign.id
  }
}

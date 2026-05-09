import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  type BotCampaignPayload,
  RedditBotService,
  type RedditPost,
  type ServiceContext,
  createRedditClientFromEnv,
} from '@phynd/services'
import type { Job } from 'bullmq'
import { getCacheManager } from '../lib/federation'

const logger = createLogger('worker:reddit-bot')

/**
 * Delay between processing individual posts (ms).
 * Keeps us well within Reddit's 60-req/min limit and avoids
 * hammering the Tezca + OpenAI APIs.
 */
const POST_PROCESSING_DELAY_MS = 2_000

/**
 * Simple keyword list for identifying posts that mention legal problems.
 * Kept intentionally broad for Mexican legal subreddits — false positives
 * are acceptable because drafts go through HITL review before posting.
 */
const LEGAL_KEYWORDS = [
  // Spanish legal terms
  'abogado',
  'abogada',
  'demanda',
  'demandaron',
  'demandar',
  'despido',
  'despidieron',
  'indemnizacion',
  'indemnizaci\u00f3n',
  'liquidacion',
  'liquidaci\u00f3n',
  'denuncia',
  'denunciar',
  'juicio',
  'amparo',
  'ministerio publico',
  'ministerio p\u00fablico',
  'procuraduria',
  'procuradur\u00eda',
  'fiscal',
  'pensi\u00f3n',
  'pension',
  'divorcio',
  'custodia',
  'herencia',
  'testamento',
  'contrato',
  'arrendamiento',
  'desalojo',
  'deuda',
  'credito',
  'cr\u00e9dito',
  'embargo',
  'hipoteca',
  'seguro social',
  'imss',
  'infonavit',
  'sat',
  'impuestos',
  'multa',
  'infraccion',
  'infracci\u00f3n',
  'accidente',
  'negligencia',
  'fraude',
  'estafa',
  'robo',
  'violencia',
  'hostigamiento',
  'acoso',
  'discriminacion',
  'discriminaci\u00f3n',
  'derechos',
  'ley federal',
  'codigo penal',
  'c\u00f3digo penal',
  'constitucion',
  'constituci\u00f3n',
  'junta de conciliacion',
  'junta de conciliaci\u00f3n',
  'tribunal',
  'sentencia',
  'apelacion',
  'apelaci\u00f3n',
  'recurso',
  'agravio',
  'profeco',
  'condusef',
  'profedet',
  'conapred',
  // English legal terms (for bilingual subreddits)
  'lawyer',
  'attorney',
  'lawsuit',
  'fired',
  'wrongful termination',
  'severance',
  'legal advice',
  'legal help',
  'sue',
  'court',
  'police report',
]

export interface RedditBotData {
  subreddits: string[]
}

/**
 * Determine the likely legal domain from post content.
 * Returns a domain label compatible with RedditBotService's materia mapping.
 */
function detectLegalDomain(text: string): string {
  const lower = text.toLowerCase()

  const domainPatterns: Array<{ domain: string; keywords: string[] }> = [
    {
      domain: 'labor',
      keywords: [
        'despido',
        'despidieron',
        'liquidacion',
        'liquidaci\u00f3n',
        'indemnizacion',
        'indemnizaci\u00f3n',
        'imss',
        'infonavit',
        'junta de conciliacion',
        'junta de conciliaci\u00f3n',
        'profedet',
        'fired',
        'severance',
        'wrongful termination',
        'patron',
        'patr\u00f3n',
        'salario',
        'n\u00f3mina',
        'nomina',
        'contrato laboral',
        'prestaciones',
      ],
    },
    {
      domain: 'criminal',
      keywords: [
        'denuncia',
        'denunciar',
        'ministerio publico',
        'ministerio p\u00fablico',
        'robo',
        'fraude',
        'estafa',
        'violencia',
        'codigo penal',
        'c\u00f3digo penal',
        'delito',
        'police report',
        'assault',
      ],
    },
    {
      domain: 'family',
      keywords: [
        'divorcio',
        'custodia',
        'pension alimenticia',
        'pensi\u00f3n alimenticia',
        'herencia',
        'testamento',
        'patria potestad',
        'guardia y custodia',
      ],
    },
    {
      domain: 'tax',
      keywords: [
        'sat',
        'impuestos',
        'fiscal',
        'rfc',
        'factura',
        'declaracion',
        'declaraci\u00f3n',
        'condusef',
      ],
    },
    {
      domain: 'civil',
      keywords: [
        'arrendamiento',
        'desalojo',
        'contrato',
        'deuda',
        'hipoteca',
        'embargo',
        'profeco',
        'negligencia',
        'accidente',
      ],
    },
    {
      domain: 'constitutional',
      keywords: ['amparo', 'constitucion', 'constituci\u00f3n', 'derechos humanos', 'conapred'],
    },
  ]

  for (const { domain, keywords } of domainPatterns) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return domain
    }
  }

  return 'civil' // safe default
}

/**
 * Check whether a Reddit post is relevant for legal outreach.
 * Uses simple keyword matching. False positives are acceptable
 * because all drafts go through human review (HITL).
 */
function isLegallyRelevant(post: RedditPost): boolean {
  const text = `${post.title} ${post.selftext}`.toLowerCase()
  return LEGAL_KEYWORDS.some((keyword) => text.includes(keyword))
}

/**
 * Build a BotCampaignPayload from a Reddit post for the RedditBotService.
 */
function buildPayload(post: RedditPost): BotCampaignPayload {
  const combinedText = `${post.title}\n\n${post.selftext}`
  const domain = detectLegalDomain(combinedText)

  return {
    campaign_type: 'reddit_legal_outreach',
    bot_identity: 'PhyndLegal — asistente legal automatizado (by /u/madfam-bot)',
    outreach_target: {
      url: post.permalink,
      author: post.author,
      original_post_content: combinedText.slice(0, 2000), // Truncate for LLM context window
    },
    legal_context: {
      distress_sentiment: 'detected_by_keyword_scan',
      core_legal_problem: post.title,
      domain,
    },
    orchestration: {
      instruction:
        'Draft a helpful Reddit comment providing Mexican legal context. ' +
        'Cite specific articles and judicial precedent from Tezca. ' +
        'Do NOT post — stage as draft for human review.',
    },
  }
}

/**
 * BullMQ processor: poll configured subreddits for new posts,
 * evaluate relevance, and stage campaign drafts via RedditBotService.
 *
 * Runs as a repeatable job every 15 minutes.
 *
 * SAFETY: This processor NEVER posts comments. It only creates
 * CRM campaign drafts (status: "draft") for human-in-the-loop review.
 */
export async function processRedditBot(job: Job<RedditBotData>): Promise<void> {
  const { subreddits } = job.data

  logger.info(
    { jobId: job.id, subreddits, count: subreddits.length },
    `Starting Reddit polling for ${subreddits.length} subreddit(s)`,
  )

  // Initialize Reddit client from env vars
  const redditClient = createRedditClientFromEnv()
  await redditClient.authenticate()

  // Build ServiceContext for RedditBotService (same pattern as session-identify processor)
  const db = getDb()
  const cache = getCacheManager()
  const ctx: ServiceContext = {
    db,
    cache,
    auth: {
      userId: 'system',
      tenantId: DEFAULT_TENANT_ID,
      roles: ['admin'],
      scopes: ['*'],
      accessToken: '',
    },
    tenantId: DEFAULT_TENANT_ID,
  }

  const botService = new RedditBotService(ctx)

  let totalScanned = 0
  let totalRelevant = 0
  let totalStaged = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const subreddit of subreddits) {
    logger.info({ subreddit }, `Polling r/${subreddit}`)

    let posts: RedditPost[]
    try {
      posts = await redditClient.getNewPosts(subreddit, 25, 2)
    } catch (err) {
      logger.error({ err, subreddit }, `Failed to fetch posts from r/${subreddit} — skipping`)
      totalErrors++
      continue
    }

    logger.info(
      { subreddit, postCount: posts.length },
      `Fetched ${posts.length} recent posts from r/${subreddit}`,
    )
    totalScanned += posts.length

    for (const post of posts) {
      // Skip deleted/removed authors
      if (post.author === '[deleted]' || post.author === 'AutoModerator') {
        totalSkipped++
        continue
      }

      // Check relevance
      if (!isLegallyRelevant(post)) {
        totalSkipped++
        continue
      }

      totalRelevant++

      // Check if we already replied (prevents duplicate drafts on re-polls)
      try {
        const alreadyReplied = await redditClient.hasReplied(post.fullname)
        if (alreadyReplied) {
          logger.info(
            { postId: post.id, subreddit, author: post.author },
            `Already replied to ${post.id} — skipping`,
          )
          totalSkipped++
          continue
        }
      } catch (err) {
        logger.warn(
          { err, postId: post.id },
          `Could not check reply history for ${post.id} — skipping to be safe`,
        )
        totalSkipped++
        continue
      }

      // Build payload and stage the campaign draft
      const payload = buildPayload(post)

      try {
        const result = await botService.processWebhook(payload)
        logger.info(
          {
            postId: post.id,
            subreddit,
            author: post.author,
            domain: payload.legal_context.domain,
            campaignId: result.draft_stage_id,
            contactId: result.contactId,
          },
          `Campaign draft staged for r/${subreddit} post ${post.id} by u/${post.author}`,
        )
        totalStaged++
      } catch (err) {
        logger.error(
          { err, postId: post.id, subreddit, author: post.author },
          `Failed to stage campaign for post ${post.id}`,
        )
        totalErrors++
      }

      // Rate limit between post processing
      await new Promise((resolve) => setTimeout(resolve, POST_PROCESSING_DELAY_MS))
    }
  }

  logger.info(
    {
      jobId: job.id,
      totalScanned,
      totalRelevant,
      totalStaged,
      totalSkipped,
      totalErrors,
      subreddits,
    },
    `Reddit polling complete: ${totalScanned} scanned, ${totalRelevant} relevant, ${totalStaged} staged, ${totalSkipped} skipped, ${totalErrors} errors`,
  )
}

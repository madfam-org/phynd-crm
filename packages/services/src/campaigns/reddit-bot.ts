import OpenAI from 'openai';
import type { ServiceContext } from '../context';
import { CampaignsService } from './campaigns.service';

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
}

export class RedditBotService {
  private openai: OpenAI;
  private campaignsService: CampaignsService;

  constructor(private readonly ctx: ServiceContext) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.campaignsService = new CampaignsService(ctx);
  }

  async processWebhook(payload: BotCampaignPayload) {
    console.log(`Starting Reddit Bot routine for: ${payload.outreach_target.url}`);
    
    // Step 1: Query Tezca API Oracle for Mexican Legal Frameworks
    const legalTextContext = await this.queryTezca(payload.legal_context.core_legal_problem);

    // Step 2: Use LLM to synthesize response
    const draftResponse = await this.draftResponse(payload, legalTextContext);

    // Step 3: Log locally as "DRAFT" in CRM instead of posting live (Human-in-the-loop safety protocol)
    const campaignId = await this.logToCRM(payload, draftResponse, legalTextContext);

    console.log(`Campaign successfully staged for review! ID: ${campaignId}`);
    return { status: "success", draft_stage_id: campaignId };
  }

  private async queryTezca(query: string): Promise<string> {
    try {
      // Direct REST API fetch to bypass @tezca/api-client token footprint dependencies
      const encodedQuery = encodeURIComponent(query);
      const res = await fetch(`http://tezca:8000/api/v1/search/articles/?q=${encodedQuery}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `ApiKey ${process.env.INTERNAL_TEZCA_KEY || 'test-key'}`,
        },
      });

      if (!res.ok) {
        console.error(`Tezca returned ${res.status}`);
        return "Legal framework unverified.";
      }
      
      const data = await res.json();
      
      // Assume Elasticsearch hits array format
      if (data.results && data.results.length > 0) {
          // Flatten top 3 matched articles
          const topHits = data.results.slice(0, 3).map((hit: any) => `Source: ${hit.law_title || 'Ley'}, Ley Art: ${hit.number || hit.id}\nContext: ${hit.text}`).join("\n\n");
          return topHits;
      }
      
      return "No specific articles found. Consult general framework.";
    } catch (e) {
      console.error("Tezca Oracle failed: ", e);
      return "Oracle offline.";
    }
  }

  private async draftResponse(payload: BotCampaignPayload, legalContext: string): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system",
            content: `You are ${payload.bot_identity}, an automated legal outreach assistant operating on Reddit. 
You provide completely rigorous, highly polite, and highly accurate Mexican Legal Context. 
Do not guess. Use ONLY the extracted legal articles provided in the context below. 
Advise the user to seek official counsel always.`
          },
          {
            role: "user",
            content: `Original Post by ${payload.outreach_target.author}:\n"${payload.outreach_target.original_post_content}"\n\nIdentified Problem: ${payload.legal_context.core_legal_problem}\n\nTezca Semantic Legal Hits:\n${legalContext}\n\nDraft the markdown response:`
          }
        ],
        temperature: 0.1,
      });

      return response.choices[0].message.content || "Drafting Error";
    } catch(e) {
      console.error("OpenAI mapping failed:", e);
      return "LLM integration failed.";
    }
  }

  private async logToCRM(payload: BotCampaignPayload, draftResponse: string, tezcaContext: string) {
      const campaign = await this.campaignsService.create({
        name: `Reddit Sync: r/${payload.outreach_target.author} - ${payload.legal_context.domain}`,
        description: `DRAFT PENDING APPROVAL:\n\n${draftResponse}\n\n---\nTezca Evidence:\n${tezcaContext}`,
        channel: "reddit_bot",
        status: "draft"
      } as any); // Casting since status isn't exposed in base create but usually maps locally

      return campaign.id;
  }
}

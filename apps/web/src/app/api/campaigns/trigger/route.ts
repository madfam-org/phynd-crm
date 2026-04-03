import { NextResponse } from 'next/server';
import { getDb } from '@phyne/db';
import { getCacheManager } from '@/lib/federation/clients';
import { createServiceContext } from '@phyne/services';
import { RedditBotService } from '@phyne/services';

export async function POST(req: Request) {
  try {
    // 1. Validate authorization secret (Fortuna to Phyne CRM)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || authHeader !== 'Bearer internal-secret-token') {
      return NextResponse.json({ error: 'Unauthorized webhook trigger' }, { status: 401 });
    }

    const payload = await req.json();

    // 2. Setup internal Service Context to inject into CRM service handlers
    const db = getDb();
    const cache = getCacheManager();
    const mockAuthCtx = {
      userId: 'automation-bot',
      tenantId: 'madfam',
      roles: ['system'],
      scopes: ['*'],
      accessToken: ''
    };
    
    // We import createServiceContext from '@phyne/services' directly per the monorepo structure
    const ctx = createServiceContext(db, cache, mockAuthCtx);
    
    // 3. Dispatch payload to Reddit Bot Campaign Service
    const botService = new RedditBotService(ctx);
    const result = await botService.processWebhook(payload);
    
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Campaign Webhook Failed:", error);
    return NextResponse.json({ error: 'Internal Server Error processing campaign' }, { status: 500 });
  }
}

import { getDb } from '@phynd/db'
import { campaigns } from '@phynd/db/schema'
import { postRedditComment } from '@phynd/services'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

type Db = ReturnType<typeof getDb>
type DraftAction = 'approved' | 'rejected'
type DraftActionBody = {
  id?: string
  action?: DraftAction
}

function draftTextFromDescription(description?: string | null) {
  const descriptionParts = description?.split('---\nTezca Evidence:') ?? []
  return descriptionParts[0]?.replace('DRAFT PENDING APPROVAL:\n\n', '').trim() ?? ''
}

async function approveDraftCampaign(db: Db, id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id))

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const draftText = draftTextFromDescription(campaign.description)
  const redditPostUrl = campaign.utmSource ?? ''
  let finalStatus = 'approved'
  let commentUrl: string | undefined

  if (redditPostUrl && draftText) {
    console.log(`Posting to Reddit: ${redditPostUrl}`)
    const result = await postRedditComment(redditPostUrl, draftText)

    if (result.success) {
      finalStatus = 'posted'
      commentUrl = result.commentUrl
      console.log(`✓ Posted to Reddit: ${commentUrl}`)
    } else {
      finalStatus = 'approved_pending_post'
      console.error(`Reddit post failed: ${result.error}`)
    }
  } else {
    finalStatus = 'approved_pending_post'
    console.warn(`Campaign ${id} approved but missing Reddit URL or draft text.`)
  }

  await db.update(campaigns).set({ status: finalStatus }).where(eq(campaigns.id, id))

  return NextResponse.json({
    success: true,
    id,
    status: finalStatus,
    ...(commentUrl && { commentUrl }),
  })
}

async function rejectDraftCampaign(db: Db, id: string, action: DraftAction) {
  await db.update(campaigns).set({ status: action }).where(eq(campaigns.id, id))
  return NextResponse.json({ success: true, id, status: action })
}

export async function POST(req: Request) {
  try {
    const { id, action } = (await req.json()) as DraftActionBody

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 })
    }

    const db = getDb()

    if (action === 'approved') {
      return approveDraftCampaign(db, id)
    }

    return rejectDraftCampaign(db, id, action)
  } catch (error) {
    console.error('Draft action failed:', error)
    return NextResponse.json({ error: 'Failed to process campaign action' }, { status: 500 })
  }
}

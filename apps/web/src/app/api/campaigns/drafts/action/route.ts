import { NextResponse } from 'next/server'
import { getDb } from '@phyne/db'
import { campaigns } from '@phyne/db/schema'
import { eq } from 'drizzle-orm'
import { postRedditComment } from '@phyne/services'

export async function POST(req: Request) {
  try {
    const { id, action } = await req.json() as { id: string; action: 'approved' | 'rejected' }

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 })
    }

    const db = getDb()

    if (action === 'approved') {
      // Fetch the campaign to get the stored Reddit URL and draft text
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id))

      if (!campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
      }

      // Extract the draft response text (before the "---\nTezca Evidence:" divider)
      const descriptionParts = campaign.description?.split('---\nTezca Evidence:') ?? []
      const draftText = descriptionParts[0]?.replace('DRAFT PENDING APPROVAL:\n\n', '').trim() ?? ''

      // The Reddit post URL is stored in utmSource (set by the bot service)
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
          // Don't fail the approval — just flag it for manual follow-up
          finalStatus = 'approved_pending_post'
          console.error(`Reddit post failed: ${result.error}`)
        }
      } else {
        // No Reddit URL stored — mark approved but not posted
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

    // For 'rejected' — just update status, no posting
    await db.update(campaigns).set({ status: action }).where(eq(campaigns.id, id))
    return NextResponse.json({ success: true, id, status: action })

  } catch (error) {
    console.error('Draft action failed:', error)
    return NextResponse.json({ error: 'Failed to process campaign action' }, { status: 500 })
  }
}

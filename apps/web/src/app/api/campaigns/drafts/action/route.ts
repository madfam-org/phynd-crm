import { NextResponse } from 'next/server'
import { getDb } from '@phyne/db'
import { campaigns } from '@phyne/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: Request) {
  try {
    const { id, action } = await req.json() as { id: string; action: 'approved' | 'rejected' }

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 })
    }

    const db = getDb()
    await db
      .update(campaigns)
      .set({ status: action })
      .where(eq(campaigns.id, id))

    return NextResponse.json({ success: true, id, status: action })
  } catch (error) {
    console.error('Draft action failed:', error)
    return NextResponse.json({ error: 'Failed to update campaign status' }, { status: 500 })
  }
}

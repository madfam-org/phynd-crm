import { readAndVerifyPortalSession } from '@/lib/portal/session'
import { getDb } from '@phynd/db'
import { engagementArtifacts } from '@phynd/db/schema'
import { NoopCacheManager } from '@phynd/federation'
import { EngagementPortalSignoffService } from '@phynd/services'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

type RouteContext = {
  params: Promise<{ engagementId: string }>
}

export async function POST(req: Request, context: RouteContext) {
  const { engagementId } = await context.params
  const session = await readAndVerifyPortalSession()

  if (!session || session.engagementId !== engagementId) {
    return NextResponse.redirect(new URL('/portal/expired?reason=no-session', req.url), 303)
  }

  const form = await req.formData()
  const artifactId = form.get('artifactId')
  if (typeof artifactId !== 'string' || !artifactId) {
    return NextResponse.redirect(
      new URL(
        `/portal/${encodeURIComponent(engagementId)}?signoff_error=missing_artifact`,
        req.url,
      ),
      303,
    )
  }

  const db = getDb()
  const [artifact] = await db
    .select({ id: engagementArtifacts.id })
    .from(engagementArtifacts)
    .where(
      and(
        eq(engagementArtifacts.id, artifactId),
        eq(engagementArtifacts.engagementId, engagementId),
        eq(engagementArtifacts.type, 'deliverable'),
      ),
    )
    .limit(1)

  if (!artifact) {
    return NextResponse.redirect(
      new URL(
        `/portal/${encodeURIComponent(engagementId)}?signoff_error=invalid_artifact`,
        req.url,
      ),
      303,
    )
  }

  try {
    const service = new EngagementPortalSignoffService({
      db,
      cache: new NoopCacheManager(),
      auth: {
        userId: `portal:${session.januaUserId}`,
        tenantId: 'madfam',
        roles: ['portal'],
        scopes: ['engagements:read'],
        accessToken: session.accessToken,
      },
      tenantId: 'madfam',
    })

    await service.acceptDeliverable({
      engagementId,
      artifactId,
      acceptedByEmail: session.email,
      acceptedByJanuaUserId: session.januaUserId,
    })

    return NextResponse.redirect(
      new URL(`/portal/${encodeURIComponent(engagementId)}?signoff=accepted`, req.url),
      303,
    )
  } catch {
    return NextResponse.redirect(
      new URL(`/portal/${encodeURIComponent(engagementId)}?signoff_error=failed`, req.url),
      303,
    )
  }
}

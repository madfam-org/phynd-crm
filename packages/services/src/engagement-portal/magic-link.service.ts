import { contacts, engagements } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError, ServiceError, ValidationError } from '../errors'

// Minimum shape Janua's /api/v1/auth/magic-link/verify returns. We
// accept both nested `tokens` and legacy flat shape — the Janua TS SDK
// handles both.
export interface JanuaMagicLinkVerifyResponse {
  user: {
    id: string
    email: string
    email_verified: boolean
  }
  tokens?: {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: 'bearer'
  }
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

interface PortalSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  email: string
  januaUserId: string
}

// Portal magic-link flow, Janua-backed:
//   1. Staff triggers sendPortalLink(engagementId) from PhyndCRM.
//   2. Janua sends the email with a URL pointing back at PhyndCRM's
//      /portal/verify?engagement=<id>&token=<janua_magic_token>.
//   3. Client clicks; PhyndCRM /portal/verify calls verifyPortalLink()
//      which exchanges the token with Janua, receives an RS256 JWT,
//      and seals it into a httpOnly cookie scoped to the portal.
//   4. Portal page reads the cookie, validates via JWKS, confirms the
//      session email matches engagement.contact.email, renders.
//
// This keeps the portal's external-client auth isolated from the
// dashboard Auth.js v5 OIDC staff flow — two distinct audiences, two
// distinct session stores, one Janua source of truth.
export class EngagementPortalMagicLinkService {
  constructor(private readonly ctx: ServiceContext) {}

  private get januaApiUrl(): string {
    const url = process.env.JANUA_API_URL
    if (!url) {
      throw new ServiceError('JANUA_API_URL not configured', 'CONFIGURATION_ERROR', 500)
    }
    return url.replace(/\/$/, '')
  }

  private get portalBaseUrl(): string {
    const base = process.env.PORTAL_BASE_URL ?? process.env.NEXTAUTH_URL
    if (!base) {
      throw new ServiceError('PORTAL_BASE_URL or NEXTAUTH_URL not configured', 'CONFIGURATION_ERROR', 500)
    }
    return base.replace(/\/$/, '')
  }

  // Resolves the target email + redirect URL for the engagement, then
  // asks Janua to send the magic-link email to the client. Returns a
  // neutral "sent" ack — never leaks the email back to the caller.
  async sendPortalLink(engagementId: string): Promise<{ sent: true; emailRedacted: string }> {
    const [row] = await this.ctx.db
      .select({
        engagementId: engagements.id,
        contactEmail: contacts.email,
      })
      .from(engagements)
      .innerJoin(contacts, eq(engagements.contactId, contacts.id))
      .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
      .limit(1)

    if (!row) {
      throw new NotFoundError('Engagement', engagementId)
    }
    if (!row.contactEmail) {
      throw new ValidationError('Engagement contact has no email on file')
    }

    const redirectUrl = `${this.portalBaseUrl}/portal/verify?engagement=${encodeURIComponent(engagementId)}`

    const resp = await fetch(`${this.januaApiUrl}/api/v1/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: row.contactEmail,
        redirect_url: redirectUrl,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new ServiceError(
        `Janua magic-link send failed (${resp.status}): ${text || resp.statusText}`,
        'JANUA_ERROR',
        resp.status === 429 ? 429 : 502,
      )
    }

    return { sent: true, emailRedacted: redactEmail(row.contactEmail) }
  }

  // Exchange the Janua magic-link token for an access/refresh pair
  // scoped to the tablaco-grade external-client session. Validates the
  // session email matches the engagement's contact email before
  // returning the session to the caller.
  async verifyPortalLink(params: {
    token: string
    engagementId: string
  }): Promise<PortalSession> {
    if (!params.token || params.token.length < 16) {
      throw new ValidationError('Invalid portal token')
    }

    // Look up engagement first so we can early-reject bad engagement
    // IDs before burning the magic-link token on Janua's side.
    const [row] = await this.ctx.db
      .select({
        engagementId: engagements.id,
        contactEmail: contacts.email,
      })
      .from(engagements)
      .innerJoin(contacts, eq(engagements.contactId, contacts.id))
      .where(and(eq(engagements.id, params.engagementId), isNull(engagements.deletedAt)))
      .limit(1)

    if (!row) {
      throw new NotFoundError('Engagement', params.engagementId)
    }

    const resp = await fetch(`${this.januaApiUrl}/api/v1/auth/magic-link/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: params.token }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new ServiceError(
        `Janua magic-link verify failed (${resp.status}): ${text || resp.statusText}`,
        'JANUA_ERROR',
        resp.status === 400 ? 401 : 502,
      )
    }

    const data = (await resp.json()) as JanuaMagicLinkVerifyResponse

    const verifiedEmail = data.user?.email?.toLowerCase().trim()
    const expectedEmail = row.contactEmail?.toLowerCase().trim()
    if (!verifiedEmail || !expectedEmail || verifiedEmail !== expectedEmail) {
      throw new ServiceError(
        'Portal token email does not match engagement contact',
        'AUTHZ_MISMATCH',
        403,
      )
    }

    const accessToken = data.tokens?.access_token ?? data.access_token
    const refreshToken = data.tokens?.refresh_token ?? data.refresh_token
    const expiresIn = data.tokens?.expires_in ?? data.expires_in ?? 900

    if (!accessToken || !refreshToken) {
      throw new ServiceError('Janua did not return expected tokens', 'JANUA_ERROR', 502)
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      email: verifiedEmail,
      januaUserId: data.user.id,
    }
  }
}

function redactEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  if (local.length <= 2) return `${local[0] ?? ''}***@${domain}`
  return `${local.slice(0, 2)}***@${domain}`
}

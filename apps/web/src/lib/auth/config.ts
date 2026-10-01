import type { NextAuthConfig } from 'next-auth'

/**
 * Extract roles and scopes from a Janua access token.
 *
 * Janua emits `roles` (array) and `scope` (space-delimited string) as claims of
 * the **access token**, not the id_token or userinfo response (see Janua
 * `oauth_provider.py` token grant). Auth.js only surfaces id_token/userinfo
 * claims through `profile`, so without decoding the access token every session
 * would resolve to empty roles/scopes and any RBAC would silently no-op.
 *
 * The token arrives directly from Janua's token endpoint over a TLS channel
 * authenticated with the client secret, so the payload is decoded (not
 * re-verified) purely to read authorization claims.
 */
function claimsFromAccessToken(accessToken: string | undefined): {
  roles: string[]
  scopes: string[]
} {
  if (!accessToken) return { roles: [], scopes: [] }
  const segments = accessToken.split('.')
  if (segments.length < 2 || !segments[1]) return { roles: [], scopes: [] }
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as {
      roles?: unknown
      scope?: unknown
      scopes?: unknown
    }
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter((r): r is string => typeof r === 'string')
      : []
    const scopes = Array.isArray(payload.scopes)
      ? payload.scopes.filter((s): s is string => typeof s === 'string')
      : typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean)
        : []
    return { roles, scopes }
  } catch {
    return { roles: [], scopes: [] }
  }
}

/**
 * The stable Janua subject (`sub`) for a sign-in.
 *
 * Auth.js v5 deliberately replaces the provider's user id with
 * `crypto.randomUUID()` in its OAuth callback and keeps the provider id only as
 * `account.providerAccountId`. Without a database adapter the default
 * `token.sub` is therefore a new random value on every sign-in, so it must not
 * be used as the user id. `providerAccountId` is what `profile()` returned as
 * `id` (the OIDC `sub` claim); the raw `profile.sub` is the same claim. Both
 * must be present and agree, otherwise the sign-in is refused rather than
 * minting a session with an unstable identity.
 */
export function januaSubjectFromSignIn(
  account: { providerAccountId?: string | null },
  profile: { sub?: unknown } | undefined,
): string {
  const fromProfile = typeof profile?.sub === 'string' ? profile.sub : ''
  const fromAccount = account.providerAccountId ?? ''
  if (!fromProfile.trim()) {
    throw new Error('Janua sign-in returned no `sub` claim; refusing to create a session')
  }
  if (fromAccount && fromAccount !== fromProfile) {
    throw new Error(
      'Janua sign-in `sub` does not match the account id; refusing to create a session',
    )
  }
  return fromProfile
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [
    {
      id: 'janua',
      name: 'Janua',
      type: 'oidc',
      issuer: process.env.AUTH_JANUA_ISSUER,
      clientId: process.env.AUTH_JANUA_CLIENT_ID,
      clientSecret: process.env.AUTH_JANUA_CLIENT_SECRET,
      authorization: { params: { scope: 'openid profile email' } },
      profile(profile) {
        return {
          id: profile.sub as string,
          email: profile.email as string,
          name: profile.name as string,
          image: (profile.picture as string) ?? null,
          roles: (profile.roles as string[]) ?? [],
          scopes: (profile.scopes as string[]) ?? [],
        }
      },
    },
  ],
  callbacks: {
    jwt({ token, account, profile }) {
      if (account) {
        // Sign-in: the session user id is the Janua subject, stable across
        // logins and devices. See januaSubjectFromSignIn for why the default
        // token.sub cannot be used.
        const subject = januaSubjectFromSignIn(account, profile)
        token.sub = subject
        token.januaSub = subject
      } else if (!token.januaSub) {
        // A session minted before the user id was the Janua subject carries a
        // random per-login id. Drop it so the user signs in again and gets the
        // stable id, instead of writing more rows under the random one.
        return null
      }
      if (account && profile) {
        token.accessToken = account.access_token
        // Prefer claims carried in profile (id_token/userinfo); fall back to
        // decoding the access token, where Janua actually places roles/scope.
        const fromToken = claimsFromAccessToken(account.access_token)
        const profileRoles = (profile.roles as string[] | undefined) ?? []
        const profileScopes = (profile.scopes as string[] | undefined) ?? []
        token.roles = profileRoles.length > 0 ? profileRoles : fromToken.roles
        token.scopes = profileScopes.length > 0 ? profileScopes : fromToken.scopes
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        // The Janua subject (see the jwt callback). Never a random Auth.js id.
        session.user.id = token.januaSub ?? ''
        session.accessToken = token.accessToken
        session.user.roles = token.roles ?? []
        session.user.scopes = token.scopes ?? []
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
}

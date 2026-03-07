import type { NextAuthConfig } from 'next-auth'

export const authConfig: NextAuthConfig = {
  providers: [
    {
      id: 'janua',
      name: 'Janua',
      type: 'oidc',
      issuer: process.env.AUTH_JANUA_ISSUER,
      clientId: process.env.AUTH_JANUA_CLIENT_ID,
      clientSecret: process.env.AUTH_JANUA_CLIENT_SECRET,
      authorization: { params: { scope: 'openid profile email roles' } },
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
      if (account && profile) {
        token.accessToken = account.access_token
        token.roles = (profile.roles as string[]) ?? []
        token.scopes = (profile.scopes as string[]) ?? []
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? ''
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

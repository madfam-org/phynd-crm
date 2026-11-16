import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    accessToken?: string
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      roles: string[]
      scopes: string[]
      /** Janua's ID token `email_verified` was `true` at sign-in. */
      januaEmailVerified?: boolean
    }
  }

  interface User {
    roles?: string[]
    scopes?: string[]
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /** Janua OIDC subject; the session user id. Absent on pre-fix sessions. */
    januaSub?: string
    /** ID token `email_verified === true` at sign-in. Absent on older sessions. */
    januaEmailVerified?: boolean
    accessToken?: string
    roles?: string[]
    scopes?: string[]
  }
}

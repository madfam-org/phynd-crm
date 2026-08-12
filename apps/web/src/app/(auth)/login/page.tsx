import { signIn } from '@/lib/auth'
import { getBrandForHost } from '@/lib/branding/tenant-brand'
import { safeNextPath } from '@/lib/http/safe-next'
import { headers } from 'next/headers'

/**
 * Human-readable copy for Auth.js error codes surfaced as `/login?error=…`.
 * Auth.js masks most callback-time failures as `Configuration`, so that code
 * gets the honest generic message. Before this banner existed, a failed SSO
 * round-trip silently re-rendered the login page — "Sign in does nothing"
 * (2026-08-12 incident).
 */
function errorCopy(code: string): string {
  switch (code) {
    case 'AccessDenied':
      return 'Your account is not allowed to access this CRM. Contact an administrator.'
    case 'Verification':
      return 'The sign-in link is no longer valid. Start again.'
    default:
      return 'Sign-in with Janua did not complete. Please try again — if this keeps happening, contact an administrator.'
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const [requestHeaders, params] = await Promise.all([headers(), searchParams])
  const brand = getBrandForHost(
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
  )
  const signInCopy =
    brand.tenantId === 'madfam'
      ? 'Sign in with your MADFAM Janua SSO account'
      : 'Sign in with Janua SSO'
  const redirectTo = safeNextPath(params.next)
  const errorCode = params.error

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="mx-auto w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">{brand.productName}</h1>
          <p className="text-muted-foreground">{signInCopy}</p>
        </div>
        {errorCode ? (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {errorCopy(errorCode)}
          </div>
        ) : null}
        <form
          action={async () => {
            'use server'
            await signIn('janua', { redirectTo })
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            Sign in with Janua
          </button>
        </form>
      </div>
    </div>
  )
}

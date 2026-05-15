import { signIn } from '@/lib/auth'
import { getBrandForHost } from '@/lib/branding/tenant-brand'
import { headers } from 'next/headers'

export default async function LoginPage() {
  const requestHeaders = await headers()
  const brand = getBrandForHost(
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'),
  )
  const signInCopy =
    brand.tenantId === 'madfam'
      ? 'Sign in with your MADFAM Janua SSO account'
      : 'Sign in with Janua SSO'

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="mx-auto w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">{brand.productName}</h1>
          <p className="text-muted-foreground">{signInCopy}</p>
        </div>
        <form
          action={async () => {
            'use server'
            await signIn('janua', { redirectTo: '/overview' })
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

import { Button } from '@/components/ui/button'

/**
 * Shown to a signed-in Janua account that is not linked to a CRM user. The CRM
 * is for staff; an administrator links an account from Settings → Users.
 */
export function NoCrmAccess({ email }: { email: string | null }) {
  return (
    <main className="flex h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold">This account has no access to the CRM</h1>
        <p className="text-sm text-muted-foreground">
          {email ? (
            <>
              You are signed in as <span className="font-medium">{email}</span>, which is not linked
              to a CRM user.
            </>
          ) : (
            'Your account is not linked to a CRM user.'
          )}{' '}
          Ask a CRM administrator to link it, then sign in again.
        </p>
        <Button variant="outline" asChild>
          <a href="/api/auth/signout">Sign out</a>
        </Button>
      </div>
    </main>
  )
}

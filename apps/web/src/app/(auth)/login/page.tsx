import { signIn } from '@/lib/auth'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="mx-auto w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">Phyne CRM</h1>
          <p className="text-muted-foreground">Sign in with your MADFAM account</p>
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

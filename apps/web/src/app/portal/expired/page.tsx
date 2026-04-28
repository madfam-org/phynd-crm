type PageProps = {
  searchParams: Promise<{ reason?: string }>
}

const REASON_COPY: Record<string, string> = {
  'no-session': 'Your portal session has expired. Please request a new link.',
  'missing-params': 'The link you clicked is incomplete. Please use the one from your email.',
  'email-mismatch':
    "This link doesn't match the project you're trying to open. Please use the latest link we sent you.",
  JANUA_ERROR: 'The link could not be verified. It may have expired — please request a new one.',
  AUTHZ_MISMATCH:
    "This link doesn't match the project you're trying to open. Please use the latest link we sent you.",
  invalid: 'This link is invalid or has already been used. Please request a fresh link.',
}

export default async function PortalExpiredPage({ searchParams }: PageProps) {
  const { reason } = await searchParams
  const message = REASON_COPY[reason ?? 'invalid'] ?? REASON_COPY.invalid

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="max-w-md px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          This link is no longer valid
        </h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{message}</p>
        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
          Need a new link? Reply to the email from our team and we'll send one right over.
        </p>
      </div>
    </main>
  )
}

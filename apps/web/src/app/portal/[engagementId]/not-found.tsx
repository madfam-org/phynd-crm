export default function PortalNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="max-w-md px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Project not found
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          We couldn't find this project. If you believe this is a mistake, reply to the email we
          sent you and we'll sort it out.
        </p>
      </div>
    </main>
  )
}

type PageProps = {
  searchParams: Promise<{ reason?: string }>
}

// No contact is known here, so the copy uses usted (the portal's default
// register when the reader has not chosen tú).
const REASON_COPY: Record<string, string> = {
  'no-session': 'Su sesión en el portal venció. Solicite un enlace nuevo.',
  'missing-params': 'El enlace está incompleto. Use el que le enviamos por correo.',
  'email-mismatch':
    'Este enlace no corresponde al proyecto que intenta abrir. Use el enlace más reciente que le enviamos.',
  JANUA_ERROR: 'No pudimos verificar el enlace. Quizá ya venció; solicite uno nuevo.',
  AUTHZ_MISMATCH:
    'Este enlace no corresponde al proyecto que intenta abrir. Use el enlace más reciente que le enviamos.',
  invalid: 'Este enlace no es válido o ya se usó. Solicite uno nuevo.',
}

export default async function PortalExpiredPage({ searchParams }: PageProps) {
  const { reason } = await searchParams
  const message = REASON_COPY[reason ?? 'invalid'] ?? REASON_COPY.invalid

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950"
      lang="es-MX"
    >
      <div className="max-w-md px-6 py-10 text-center">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Este enlace ya no es válido
        </h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{message}</p>
        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
          ¿Necesita un enlace nuevo? Responda al correo de nuestro equipo y se lo enviamos
          enseguida.
        </p>
      </div>
    </main>
  )
}

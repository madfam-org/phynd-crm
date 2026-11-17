'use client'

import { Button } from '@/components/ui/button'
import { endSession } from '@/lib/auth/client-session'
import { useState } from 'react'

/** Signs out of the CRM and ends the Janua session (lib/auth/client-session). */
export function SignOutButton({ variant = 'ghost' }: { variant?: 'ghost' | 'outline' }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void endSession()
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}

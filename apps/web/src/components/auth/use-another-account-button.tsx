'use client'

import { Button } from '@/components/ui/button'
import { switchAccount } from '@/lib/auth/client-session'
import { useState } from 'react'

/** Leaves this account and signs in through Janua's account chooser. */
export function UseAnotherAccountButton({ redirectTo = '/leads' }: { redirectTo?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void switchAccount(redirectTo)
      }}
    >
      Use another account
    </Button>
  )
}

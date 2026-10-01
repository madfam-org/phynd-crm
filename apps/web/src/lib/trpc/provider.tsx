'use client'

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { useState } from 'react'
import { toast } from 'sonner'
import superjson from 'superjson'
import { trpc } from './client'
import {
  CRM_USER_NOT_LINKED_MESSAGE,
  CRM_USER_NOT_LINKED_TOAST_ID,
  isCrmUserNotLinkedError,
  shouldRetryQuery,
} from './errors'

function notifyIfNotLinked(err: unknown) {
  if (isCrmUserNotLinkedError(err)) {
    toast.error(CRM_USER_NOT_LINKED_MESSAGE, { id: CRM_USER_NOT_LINKED_TOAST_ID })
  }
}

function getBaseUrl() {
  if (typeof window !== 'undefined') return ''
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // A Janua identity without a linked CRM user gets one clear message
        // wherever a per-user query or write fails. Mutations with their own
        // onError already show the error message themselves.
        queryCache: new QueryCache({ onError: notifyIfNotLinked }),
        mutationCache: new MutationCache({
          onError: (err, _vars, _ctx, mutation) => {
            if (!mutation.options.onError) notifyIfNotLinked(err)
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            refetchOnWindowFocus: false,
            retry: shouldRetryQuery,
          },
        },
      }),
  )

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    }),
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}

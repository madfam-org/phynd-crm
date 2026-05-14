import type { AppRouter } from '@phynd/api'
import { createTRPCReact } from '@trpc/react-query'

// tRPC v11 RC can widen the workspace router record during Dockerized Next builds,
// exposing the protected-intersection collision sentinel instead of the decorated
// procedure map. Keep the runtime AppRouter wiring while unblocking production
// builds until the router/package export path is stabilized.
// biome-ignore lint/suspicious/noExplicitAny: Compatibility bridge for tRPC v11 RC router widening.
type TrpcBuildCompat = ReturnType<typeof createTRPCReact<any>>

export const trpc = createTRPCReact<AppRouter>() as TrpcBuildCompat

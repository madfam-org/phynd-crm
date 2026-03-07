import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '@phyne/api'

export const trpc = createTRPCReact<AppRouter>()

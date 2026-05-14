import type { AppRouter } from '@phynd/api'
import { createTRPCReact } from '@trpc/react-query'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { ComponentType, ReactNode } from 'react'

type RouterInputs = inferRouterInputs<AppRouter>
type RouterOutputs = inferRouterOutputs<AppRouter>

interface QueryOptions<TOutput> {
  enabled?: boolean
  initialData?: TOutput
  refetchInterval?: false | number
  retry?: boolean | number
}

interface QueryResult<TOutput> {
  data: TOutput
  error: Error | null
  isError: boolean
  isLoading: boolean
  isPending: boolean
  refetch: () => Promise<unknown>
}

interface MutationOptions<TInput, TOutput> {
  onError?: (err: Error, variables: TInput | undefined, context: unknown) => void
  onSettled?: (data: TOutput | undefined, err: Error | null) => void
  onSuccess?: (
    data: TOutput,
    variables: TInput | undefined,
    context: unknown,
  ) => void | Promise<void>
}

interface MutationResult<TInput, TOutput> {
  data: TOutput | undefined
  error: Error | null
  isError: boolean
  isPending: boolean
  isSuccess: boolean
  mutate: (input?: TInput, options?: MutationOptions<TInput, TOutput>) => void
  mutateAsync: (input?: TInput, options?: MutationOptions<TInput, TOutput>) => Promise<TOutput>
  reset: () => void
}

interface ProcedureCompat<TInput, TOutput> {
  useMutation: (options?: MutationOptions<TInput, TOutput>) => MutationResult<TInput, TOutput>
  useQuery: (input?: TInput, options?: QueryOptions<TOutput>) => QueryResult<TOutput>
}

type RouterCompat = {
  [TRouter in keyof RouterOutputs]: {
    [TProcedure in keyof RouterOutputs[TRouter]]: ProcedureCompat<
      TProcedure extends keyof RouterInputs[TRouter] ? RouterInputs[TRouter][TProcedure] : never,
      RouterOutputs[TRouter][TProcedure]
    >
  }
}

type UtilsCompat = {
  [TRouter in keyof RouterOutputs]: {
    [TProcedure in keyof RouterOutputs[TRouter]]: {
      invalidate: (input?: unknown) => Promise<void>
    }
  }
}

type TrpcProviderCompat = ComponentType<{
  children?: ReactNode
  client: unknown
  queryClient: unknown
}>

type TrpcBuildCompat = RouterCompat & {
  Provider: TrpcProviderCompat
  createClient: (options: unknown) => unknown
  useUtils: () => UtilsCompat
}

// tRPC v11 RC can widen the workspace router record during Dockerized Next builds,
// exposing the protected-intersection collision sentinel instead of the decorated
// procedure map. Keep runtime AppRouter wiring while preserving enough inferred
// input/output typing for production typecheck until the package export path is fixed.

export const trpc = createTRPCReact<AppRouter>() as unknown as TrpcBuildCompat

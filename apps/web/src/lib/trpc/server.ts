import 'server-only'
import { createCallerFactory } from '@phyne/api'
import { appRouter } from '@phyne/api/router'

export const createCaller = createCallerFactory(appRouter)

import { activitiesRouter } from './routers/activities'
import { contactsRouter } from './routers/contacts'
import { federationHealthRouter } from './routers/federation-health'
import { leadsRouter } from './routers/leads'
import { opportunitiesRouter } from './routers/opportunities'
import { pipelinesRouter } from './routers/pipelines'
import { unifiedProfileRouter } from './routers/unified-profile'
import { router } from './trpc'

export const appRouter = router({
  contacts: contactsRouter,
  leads: leadsRouter,
  opportunities: opportunitiesRouter,
  pipelines: pipelinesRouter,
  activities: activitiesRouter,
  unifiedProfile: unifiedProfileRouter,
  federationHealth: federationHealthRouter,
})

export type AppRouter = typeof appRouter

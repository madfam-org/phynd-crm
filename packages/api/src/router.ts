import { router } from './trpc'
import { contactsRouter } from './routers/contacts'
import { leadsRouter } from './routers/leads'
import { opportunitiesRouter } from './routers/opportunities'
import { pipelinesRouter } from './routers/pipelines'
import { activitiesRouter } from './routers/activities'
import { unifiedProfileRouter } from './routers/unified-profile'
import { federationHealthRouter } from './routers/federation-health'

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

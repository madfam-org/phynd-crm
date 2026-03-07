import { activitiesRouter } from './routers/activities'
import { analyticsRouter } from './routers/analytics'
import { campaignsRouter } from './routers/campaigns'
import { contactsRouter } from './routers/contacts'
import { conversionsRouter } from './routers/conversions'
import { federationHealthRouter } from './routers/federation-health'
import { leadScoringRouter } from './routers/lead-scoring'
import { leadsRouter } from './routers/leads'
import { offersRouter } from './routers/offers'
import { opportunitiesRouter } from './routers/opportunities'
import { pipelinesRouter } from './routers/pipelines'
import { unifiedProfileRouter } from './routers/unified-profile'
import { visitorTrackingRouter } from './routers/visitor-tracking'
import { router } from './trpc'

export const appRouter = router({
  contacts: contactsRouter,
  leads: leadsRouter,
  opportunities: opportunitiesRouter,
  pipelines: pipelinesRouter,
  activities: activitiesRouter,
  unifiedProfile: unifiedProfileRouter,
  federationHealth: federationHealthRouter,
  visitorTracking: visitorTrackingRouter,
  offers: offersRouter,
  campaigns: campaignsRouter,
  conversions: conversionsRouter,
  analytics: analyticsRouter,
  leadScoring: leadScoringRouter,
})

export type AppRouter = typeof appRouter

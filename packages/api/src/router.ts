import { activitiesRouter } from './routers/activities'
import { analyticsRouter } from './routers/analytics'
import { campaignsRouter } from './routers/campaigns'
import { contactsRouter } from './routers/contacts'
import { conversionsRouter } from './routers/conversions'
import { federationHealthRouter } from './routers/federation-health'
import { leadScoringRouter } from './routers/lead-scoring'
import { leadsRouter } from './routers/leads'
import { notesRouter } from './routers/notes'
import { offersRouter } from './routers/offers'
import { opportunitiesRouter } from './routers/opportunities'
import { pipelinesRouter } from './routers/pipelines'
import { preferencesRouter } from './routers/preferences'
import { searchRouter } from './routers/search'
import { tagsRouter } from './routers/tags'
import { unifiedProfileRouter } from './routers/unified-profile'
import { usersRouter } from './routers/users'
import { visitorTrackingRouter } from './routers/visitor-tracking'
import { router } from './trpc'

export const appRouter = router({
  activities: activitiesRouter,
  analytics: analyticsRouter,
  campaigns: campaignsRouter,
  contacts: contactsRouter,
  conversions: conversionsRouter,
  federationHealth: federationHealthRouter,
  leadScoring: leadScoringRouter,
  leads: leadsRouter,
  notes: notesRouter,
  offers: offersRouter,
  opportunities: opportunitiesRouter,
  pipelines: pipelinesRouter,
  preferences: preferencesRouter,
  search: searchRouter,
  tags: tagsRouter,
  unifiedProfile: unifiedProfileRouter,
  users: usersRouter,
  visitorTracking: visitorTrackingRouter,
})

export type AppRouter = typeof appRouter

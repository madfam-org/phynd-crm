import { activitiesRouter } from './routers/activities'
import { aiKanbanRouter } from './routers/ai-kanban'
import { analyticsRouter } from './routers/analytics'
import { campaignsRouter } from './routers/campaigns'
import { consentRouter } from './routers/consent'
import { contactsRouter } from './routers/contacts'
import { conversionsRouter } from './routers/conversions'
import { engagementsRouter } from './routers/engagements'
import { federationHealthRouter } from './routers/federation-health'
import { grantsRouter } from './routers/grants'
import { leadScoringRouter } from './routers/lead-scoring'
import { leadsRouter } from './routers/leads'
import { notesRouter } from './routers/notes'
import { notificationsRouter } from './routers/notifications'
import { offersRouter } from './routers/offers'
import { opportunitiesRouter } from './routers/opportunities'
import { ordersRouter } from './routers/orders'
import { pipelinesRouter } from './routers/pipelines'
import { preferencesRouter } from './routers/preferences'
import { quotesRouter } from './routers/quotes'
import { referralsRouter } from './routers/referrals'
import { searchRouter } from './routers/search'
import { tagsRouter } from './routers/tags'
import { timelineRouter } from './routers/timeline'
import { unifiedProfileRouter } from './routers/unified-profile'
import { usersRouter } from './routers/users'
import { visitorTrackingRouter } from './routers/visitor-tracking'
import { router } from './trpc'

export const appRouter = router({
  activities: activitiesRouter,
  aiKanban: aiKanbanRouter,
  analytics: analyticsRouter,
  campaigns: campaignsRouter,
  consent: consentRouter,
  contacts: contactsRouter,
  conversions: conversionsRouter,
  engagements: engagementsRouter,
  federationHealth: federationHealthRouter,
  grants: grantsRouter,
  leadScoring: leadScoringRouter,
  leads: leadsRouter,
  notes: notesRouter,
  notifications: notificationsRouter,
  offers: offersRouter,
  opportunities: opportunitiesRouter,
  orders: ordersRouter,
  pipelines: pipelinesRouter,
  preferences: preferencesRouter,
  quotes: quotesRouter,
  referrals: referralsRouter,
  search: searchRouter,
  tags: tagsRouter,
  timeline: timelineRouter,
  unifiedProfile: unifiedProfileRouter,
  users: usersRouter,
  visitorTracking: visitorTrackingRouter,
})

export type AppRouter = typeof appRouter

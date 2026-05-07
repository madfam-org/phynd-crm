export { ActivitiesService } from './activities/activities.service'
export { AnalyticsService } from './analytics/analytics.service'
export { CampaignsService } from './campaigns/campaigns.service'
export { RedditBotService, type BotCampaignPayload } from './campaigns/reddit-bot'
export { RedditClient, createRedditClientFromEnv, type RedditPost } from './campaigns/reddit-client'
export { postRedditComment, extractPostId } from './campaigns/reddit-poster'
export { ContactsService } from './contacts/contacts.service'
export { ConversionsService } from './conversions/conversions.service'
export {
  type CotizaEngagementEmitter,
  EngagementsService,
  type EngagementTimelineEntry,
} from './engagements/engagements.service'
export {
  type CotizaEngagementEvent,
  type CotizaEngagementEventType,
  dispatchCotizaEngagementEvent,
  emitCotizaEngagementEvent,
} from './engagements/cotiza-engagement-emitter.service'
export { EngagementPortalMagicLinkService } from './engagement-portal/magic-link.service'
export { createServiceContext, type ServiceContext } from './context'
export { GrantsService } from './grants/grants.service'
export { LeadScoringService } from './lead-scoring/lead-scoring.service'
export { LeadsService } from './leads/leads.service'
export { NotesService } from './notes/notes.service'
export { NotificationsService } from './notifications/notifications.service'
export { OffersService } from './offers/offers.service'
export {
  ClientProjectOnboardingService,
  type ClientProjectDeliveryTrack,
  type ClientProjectKind,
  type ClientProjectOnboardingInput,
  type ClientProjectOnboardingResult,
} from './onboarding/client-project-onboarding.service'
export { OpportunitiesService } from './opportunities/opportunities.service'
export { OrdersService } from './orders/orders.service'
export { PipelinesService } from './pipelines/pipelines.service'
export { QuotesService } from './quotes/quotes.service'
export { ReferralService } from './referrals/referrals.service'
export { PreferencesService } from './preferences/preferences.service'
export { SearchService, type SearchResult } from './search/search.service'
export { TagsService } from './tags/tags.service'
export { TimelineService, type TimelineEntry } from './timeline/timeline.service'
export { UnifiedProfileService } from './unified-profile/profile.service'
export { UsersService } from './users/users.service'
export { VisitorTrackingService } from './visitor-tracking/visitor-tracking.service'
export { EmailService } from './email/email.service'

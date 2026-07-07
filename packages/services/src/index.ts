export { ActivitiesService } from './activities/activities.service'
export { AiKanbanService } from './ai-kanban/ai-kanban.service'
export { AnalyticsService } from './analytics/analytics.service'
export { CampaignsService } from './campaigns/campaigns.service'
export { CampaignBuyerSignalService } from './campaigns/campaign-buyer-signal.service'
export {
  CampaignEmailEventService,
  type EmailEventType,
  type IngestResult,
  type RecordEmailEventInput,
  type ResendWebhookEvent,
} from './campaigns/campaign-email-event.service'
export {
  checkCampaignSendEligibility,
  consentChannelForOutreach,
  evaluateContactEligibility,
  type CampaignSendEligibility,
  type ConsentGateInput,
} from './campaigns/campaign-send-gate'
export {
  ConsentService,
  type CaptureConsentInput,
  type CaptureConsentResult,
  type ConsentPermission,
  type ConsentRecord,
} from './consent/consent.service'
export {
  CONSENT_ACTIONS,
  CONSENT_CHANNELS,
  CONSENT_STATUSES,
  isConsentAction,
  isConsentChannel,
  nextConsentStatus,
  normalizeConsentIdentifier,
  type ConsentAction,
  type ConsentChannel,
  type ConsentStatus,
} from './consent/consent-state-machine'
export {
  buildConsentConfirmUrl,
  generateDoubleOptInToken,
  hashDoubleOptInToken,
} from './consent/double-opt-in-token'
export {
  SUPPRESSION_CHANNELS,
  SUPPRESSION_REASONS,
  SuppressionService,
  type AddSuppressionInput,
  type SuppressionChannel,
  type SuppressionCheckResult,
  type SuppressionReason,
} from './consent/suppression.service'
export { TulanaCampaignImportService } from './campaigns/tulana-import.service'
export {
  tulanaCampaignImportSchema,
  structuredDraftVariantSchema,
  draftVariantSchema,
  normalizeDraftVariant,
  type DraftVariantInput,
  type StructuredDraftVariantInput,
  type NormalizedDraftVariant,
} from './campaigns/tulana-import.schema'
export { CampaignDraftVariantService } from './campaigns/campaign-draft-variant.service'
export { RedditBotService, type BotCampaignPayload } from './campaigns/reddit-bot'
export { RedditClient, createRedditClientFromEnv, type RedditPost } from './campaigns/reddit-client'
export { postRedditComment, extractPostId } from './campaigns/reddit-poster'
export { ContactsService } from './contacts/contacts.service'
export { ConversionsService } from './conversions/conversions.service'
export {
  canonicalKarafielMilestone,
  canonicalSelvaMilestone,
  karafielPortalStatus,
  selvaPortalStatus,
} from './engagements/engagement-milestone.helpers'
export {
  type CotizaEngagementEmitter,
  EngagementsService,
  type EngagementTimelineEntry,
} from './engagements/engagements.service'
export {
  PublishQuoteToPortalService,
  type PublishQuoteToPortalInput,
  type PublishQuoteToPortalResult,
} from './engagements/publish-quote-to-portal.service'
export {
  EngagementRecoveryService,
  type DeliveryTrack as EngagementDeliveryTrack,
} from './engagements/engagement-recovery.service'
export {
  type CotizaEngagementEvent,
  type CotizaEngagementEventType,
  dispatchCotizaEngagementEvent,
  emitCotizaEngagementEvent,
} from './engagements/cotiza-engagement-emitter.service'
export { EngagementPortalMagicLinkService } from './engagement-portal/magic-link.service'
export { EngagementPortalSignoffService } from './engagement-portal/signoff.service'
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
export {
  maskEmail,
  maskFreeText,
  maskPersonName,
  maskPhone,
  shouldMaskPiiForAgent,
} from './pii/mask'
export { OrdersService } from './orders/orders.service'
export {
  type CreateDhanamCheckoutInput,
  DhanamCheckoutService,
  type DhanamCheckoutResult,
} from './payments/dhanam-checkout.service'
export {
  type DhanamPaymentLifecycle,
  type DhanamPaymentLifecycleInput,
  type DhanamPaymentReconciliationInput,
  type PaymentReconciliationResult,
  reconcileDhanamPayment,
  reconcileDhanamPaymentLifecycle,
} from './payments/payment-reconciliation.service'
export { PipelinesService } from './pipelines/pipelines.service'
export {
  type ProductionDispatchIntentInput,
  recordProductionDispatchIntent,
} from './production/production-dispatch.service'
export {
  dispatchPendingProductionDispatches,
  dispatchProductionDispatchReference,
  listPendingProductionDispatchReferenceIds,
  type DispatchProductionOptions,
  type DispatchProductionResult,
  type DispatchProductionSummary,
} from './production/production-dispatch-http.service'
export {
  type AcceptQuoteInput,
  type AcceptQuoteResult,
  QuotesService,
} from './quotes/quotes.service'
export { ReferralService } from './referrals/referrals.service'
export { PreferencesService } from './preferences/preferences.service'
export { SearchService, type SearchResult } from './search/search.service'
export { TagsService } from './tags/tags.service'
export { TimelineService, type TimelineEntry } from './timeline/timeline.service'
export { UnifiedProfileService } from './unified-profile/profile.service'
export { UsersService } from './users/users.service'
export { VisitorTrackingService } from './visitor-tracking/visitor-tracking.service'
export { EmailService } from './email/email.service'

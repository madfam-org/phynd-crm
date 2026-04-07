export type EntityType = 'contact' | 'lead' | 'opportunity' | 'order' | 'quote'

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired'
export type OrderStatus = 'pending' | 'confirmed' | 'in_production' | 'fulfilled' | 'cancelled'

export interface Contact {
  id: string
  externalJanuaId: string | null
  name: string
  email: string | null
  phone: string | null
  company: string | null
  status: ContactStatus
  ownerId: string | null
  createdAt: Date
  updatedAt: Date
}

export type ContactStatus = 'active' | 'inactive' | 'archived'

export interface Lead {
  id: string
  contactId: string | null
  externalJanuaId: string | null
  source: string | null
  status: LeadStatus
  score: number | null
  pipelineId: string
  stageId: string
  ownerId: string | null
  createdAt: Date
  updatedAt: Date
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted'

export interface Opportunity {
  id: string
  name: string
  contactId: string | null
  pipelineId: string
  stageId: string
  value: number | null
  probability: number | null
  status: OpportunityStatus
  expectedCloseDate: Date | null
  ownerId: string | null
  createdAt: Date
  updatedAt: Date
}

export type OpportunityStatus = 'open' | 'won' | 'lost'

export interface Pipeline {
  id: string
  name: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

export interface PipelineStage {
  id: string
  pipelineId: string
  name: string
  position: number
  probability: number | null
  createdAt: Date
  updatedAt: Date
}

export interface Activity {
  id: string
  type: ActivityType
  title: string
  description: string | null
  status: ActivityStatus
  dueAt: Date | null
  completedAt: Date | null
  entityType: EntityType
  entityId: string
  ownerId: string | null
  createdAt: Date
  updatedAt: Date
}

export type ActivityType = 'call' | 'email' | 'fabrication_update' | 'meeting' | 'task' | 'note'
export type ActivityStatus = 'pending' | 'completed' | 'cancelled'

export interface Note {
  id: string
  content: string
  entityType: EntityType
  entityId: string
  authorId: string
  isPinned: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Tag {
  id: string
  name: string
  color: string | null
  createdAt: Date
}

export interface Taggable {
  tagId: string
  entityType: EntityType
  entityId: string
}

export interface ExternalReference {
  id: string
  entityType: EntityType
  entityId: string
  provider: FederationProviderName
  externalId: string
  externalType: string | null
  metadata: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export type FederationProviderName =
  | 'janua'
  | 'dhanam'
  | 'cotiza'
  | 'pravara'
  | 'forj'
  | 'tezca'
  | 'janua-telemetry'

export interface Offer {
  id: string
  name: string
  description: string | null
  type: OfferType
  value: number | null
  currency: string | null
  validFrom: Date | null
  validUntil: Date | null
  maxRedemptions: number | null
  currentRedemptions: number
  status: OfferStatus
  externalProductId: string | null
  externalProvider: FederationProviderName | null
  createdAt: Date
  updatedAt: Date
}

export type OfferType = 'discount' | 'bundle' | 'free_trial' | 'custom'
export type OfferStatus = 'draft' | 'active' | 'paused' | 'expired'

export interface Campaign {
  id: string
  name: string
  description: string | null
  channel: CampaignChannel
  status: CampaignStatus
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  budget: number | null
  spend: string | null
  currency: string | null
  startDate: Date | null
  endDate: Date | null
  offerId: string | null
  createdAt: Date
  updatedAt: Date
}

export type CampaignChannel =
  | 'email'
  | 'social'
  | 'paid_search'
  | 'organic'
  | 'referral'
  | 'direct'
  | 'other'
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed'

export interface Conversion {
  id: string
  type: ConversionType
  contactId: string | null
  leadId: string | null
  opportunityId: string | null
  campaignId: string | null
  visitorSessionId: string | null
  value: number | null
  metadata: Record<string, unknown> | null
  convertedAt: Date
}

export type ConversionType =
  | 'visitor_to_lead'
  | 'lead_to_opportunity'
  | 'opportunity_to_won'
  | 'offer_redemption'

export interface RoleViewPreference {
  id: string
  role: string
  panelOrder: string[]
  defaultTab: string | null
  visibleColumns: Record<string, string[]> | null
  createdAt: Date
  updatedAt: Date
}

export interface WebhookEvent {
  id: string
  provider: FederationProviderName
  eventType: string
  payload: Record<string, unknown>
  processedAt: Date | null
  error: string | null
  createdAt: Date
}

export interface ScoringCondition {
  field: string
  operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'exists'
  value?: unknown
}

export interface PaginationInput {
  cursor?: string
  limit?: number
}

export interface PaginatedResult<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

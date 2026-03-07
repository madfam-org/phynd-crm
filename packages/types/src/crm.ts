export type EntityType = 'contact' | 'lead' | 'opportunity'

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

export type ActivityType = 'call' | 'email' | 'meeting' | 'task' | 'note'
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

export type FederationProviderName = 'janua' | 'dhanam' | 'cotiza' | 'forj'

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

import type { Database } from '../client'

export type Db = Database

export interface SeedIds {
  adminId: string
  pipelineId: string
  stages: { id: string }[]
  deliveryPipelineId: string
  deliveryStages: { id: string }[]
  contacts: { id: string }[]
  leads: { id: string }[]
  opps: { id: string }[]
  quotes: { id: string }[]
  offers: { id: string }[]
  campaigns: { id: string }[]
  sessions: { id: string }[]
  tags: { id: string }[]
}

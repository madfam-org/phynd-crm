import type { Database } from '@phynd/db'
import { contacts, externalReferences, leads, webhookEvents } from '@phynd/db/schema'
import type { CacheManagerLike } from '@phynd/federation'
import type { AuthContext } from '@phynd/types/auth'
import type { LeadAttribution } from '@phynd/types/crm'
import { and, eq, sql } from 'drizzle-orm'
import { ActivitiesService } from '../activities/activities.service'
import { ContactsService } from '../contacts/contacts.service'
import { type ServiceContext, createServiceContext, withTransaction } from '../context'
import { LeadsService } from '../leads/leads.service'
import { NotesService } from '../notes/notes.service'
import { PipelinesService } from '../pipelines/pipelines.service'
import { resolveSystemTaskOwner } from '../tasks/system-task-owner'
import {
  CENSUS_ACTOR_ID,
  CENSUS_LINK_TYPE,
  CENSUS_PROVIDER,
  type CensusContactRecord,
  type CensusLeadRecord,
  type CensusPickLink,
  type CensusTenantStore,
  type CensusTenantTx,
} from './census-handoff'

interface WarnLogger {
  warn(fields: Record<string, unknown>, message: string): void
}

export interface CensusTenantStoreDeps {
  /** The tenant's own database (`getDb(tenantId)`). */
  db: Database
  cache: CacheManagerLike
  tenantId: string
  logger: WarnLogger
  /** Defaults to `process.env` (default task owner lookup). */
  env?: Record<string, string | undefined>
}

/** `<platform>:<channel id>`, the `external_references.external_id` of a pick link. */
export function censusLinkExternalId(platform: string, externalId: string): string {
  return `${platform}:${externalId}`
}

/**
 * {@link CensusTenantStore} on the CRM's services and tables. Contacts, leads,
 * notes and activities go through the same services as lead intake; only the
 * advisory lock, the processed-event record and the pick link are plain
 * queries.
 */
export function createCensusTenantStore(deps: CensusTenantStoreDeps): CensusTenantStore {
  const auth: AuthContext = {
    userId: CENSUS_ACTOR_ID,
    tenantId: deps.tenantId,
    roles: ['service'],
    scopes: ['*'],
    accessToken: 'internal:census-events',
  }
  const base = createServiceContext(deps.db, deps.cache, auth, deps.tenantId)
  return {
    run: (work) =>
      deps.db.transaction((tx) => work(new DrizzleCensusTx(withTransaction(base, tx), deps))),
  }
}

type LinkMetadata = { org_id?: unknown; list_id?: unknown; contact_id?: unknown }

function toLink(row: { id: string; entityId: string; metadata: unknown }): CensusPickLink {
  const metadata = (row.metadata ?? {}) as LinkMetadata
  return {
    id: row.id,
    leadId: row.entityId,
    contactId: typeof metadata.contact_id === 'string' ? metadata.contact_id : null,
  }
}

function toLead(row: typeof leads.$inferSelect): CensusLeadRecord {
  return {
    id: row.id,
    contactId: row.contactId,
    attribution: (row.attribution as LeadAttribution | null) ?? null,
  }
}

function toContact(row: typeof contacts.$inferSelect): CensusContactRecord {
  return { id: row.id, name: row.name, ownerId: row.ownerId }
}

class DrizzleCensusTx implements CensusTenantTx {
  constructor(
    private readonly ctx: ServiceContext,
    private readonly deps: CensusTenantStoreDeps,
  ) {}

  private get db(): Database {
    return this.ctx.db
  }

  async lock(key: string): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, CENSUS_PROVIDER),
          sql`${webhookEvents.payload} ->> 'event_id' = ${eventId}`,
        ),
      )
      .limit(1)
    return rows.length > 0
  }

  async recordProcessedEvent(record: {
    eventId: string
    eventType: string
    summary: Record<string, string>
  }): Promise<void> {
    await this.db.insert(webhookEvents).values({
      provider: CENSUS_PROVIDER,
      eventType: record.eventType,
      payload: { ...record.summary, event_id: record.eventId },
      processedAt: new Date(),
    })
  }

  private linkConditions(platform: string, externalId: string) {
    return [
      eq(externalReferences.provider, CENSUS_PROVIDER),
      eq(externalReferences.externalType, CENSUS_LINK_TYPE),
      eq(externalReferences.entityType, 'lead'),
      eq(externalReferences.externalId, censusLinkExternalId(platform, externalId)),
    ]
  }

  async findPickLink(
    orgId: string,
    platform: string,
    externalId: string,
  ): Promise<CensusPickLink | null> {
    const [row] = await this.db
      .select({
        id: externalReferences.id,
        entityId: externalReferences.entityId,
        metadata: externalReferences.metadata,
      })
      .from(externalReferences)
      .where(
        and(
          ...this.linkConditions(platform, externalId),
          sql`${externalReferences.metadata} ->> 'org_id' = ${orgId}`,
        ),
      )
      .limit(1)
    return row ? toLink(row) : null
  }

  async findPickLinksForChannel(platform: string, externalId: string): Promise<CensusPickLink[]> {
    const rows = await this.db
      .select({
        id: externalReferences.id,
        entityId: externalReferences.entityId,
        metadata: externalReferences.metadata,
      })
      .from(externalReferences)
      .where(and(...this.linkConditions(platform, externalId)))
    return rows.map(toLink)
  }

  async saveLink(link: {
    id?: string
    orgId: string
    listId: string
    platform: string
    externalId: string
    leadId: string
    contactId: string | null
  }): Promise<void> {
    const metadata = { org_id: link.orgId, list_id: link.listId, contact_id: link.contactId }
    if (link.id) {
      await this.db
        .update(externalReferences)
        .set({ entityId: link.leadId, metadata })
        .where(eq(externalReferences.id, link.id))
      return
    }
    await this.db.insert(externalReferences).values({
      entityType: 'lead',
      entityId: link.leadId,
      provider: CENSUS_PROVIDER,
      externalId: censusLinkExternalId(link.platform, link.externalId),
      externalType: CENSUS_LINK_TYPE,
      metadata,
    })
  }

  async deleteLink(id: string): Promise<void> {
    await this.db.delete(externalReferences).where(eq(externalReferences.id, id))
  }

  async getLiveLead(id: string): Promise<CensusLeadRecord | null> {
    const row = await new LeadsService(this.ctx).getById(id)
    return row ? toLead(row) : null
  }

  async getAnyLead(id: string): Promise<CensusLeadRecord | null> {
    const [row] = await this.db.select().from(leads).where(eq(leads.id, id)).limit(1)
    return row ? toLead(row) : null
  }

  async getLiveContact(id: string): Promise<CensusContactRecord | null> {
    const row = await new ContactsService(this.ctx).getById(id)
    return row ? toContact(row) : null
  }

  async getAnyContact(id: string): Promise<CensusContactRecord | null> {
    const [row] = await this.db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
    return row ? toContact(row) : null
  }

  async createContact(input: { name: string }): Promise<CensusContactRecord> {
    return toContact(await new ContactsService(this.ctx).create({ name: input.name }))
  }

  async renameContact(id: string, name: string): Promise<void> {
    await new ContactsService(this.ctx).update(id, { name })
  }

  async createLeadInDefaultPipeline(input: {
    contactId: string
    source: string
    attribution: LeadAttribution
  }): Promise<{ id: string } | null> {
    const pipelines = new PipelinesService(this.ctx)
    const pipeline = await pipelines.getDefault()
    if (!pipeline) return null
    const [firstStage] = await pipelines.getStages(pipeline.id)
    if (!firstStage) return null
    const lead = await new LeadsService(this.ctx).create({
      contactId: input.contactId,
      source: input.source,
      attribution: input.attribution,
      pipelineId: pipeline.id,
      stageId: firstStage.id,
    })
    return { id: lead.id }
  }

  async setLeadAttribution(leadId: string, attribution: LeadAttribution | null): Promise<void> {
    await new LeadsService(this.ctx).updateAttribution(leadId, attribution)
  }

  async addLeadNote(leadId: string, content: string): Promise<void> {
    await new NotesService(this.ctx).create({ content, entityType: 'lead', entityId: leadId })
  }

  async listCensusNotes(leadId: string): Promise<{ id: string; content: string }[]> {
    const notes = await new NotesService(this.ctx).listForEntity('lead', leadId)
    return notes
      .filter((note) => note.authorId === CENSUS_ACTOR_ID)
      .map((note) => ({ id: note.id, content: note.content }))
  }

  async updateNote(id: string, content: string): Promise<void> {
    await new NotesService(this.ctx).update(id, { content })
  }

  async openFollowUpTask(input: {
    leadId: string
    contactOwnerId: string | null
    title: string
    description: string
    dueAt: Date
  }): Promise<boolean> {
    try {
      // A savepoint: a failed task rolls back alone and the lead is kept.
      await this.db.transaction(async (savepoint) => {
        const ownerId = await resolveSystemTaskOwner(savepoint, this.deps.logger, {
          contactOwnerId: input.contactOwnerId,
          logContext: { task: 'census_pick_follow_up', lead_id: input.leadId },
          env: this.deps.env,
        })
        await new ActivitiesService(withTransaction(this.ctx, savepoint)).create({
          type: 'task',
          title: input.title,
          description: input.description,
          dueAt: input.dueAt,
          entityType: 'lead',
          entityId: input.leadId,
          ownerId,
        })
      })
      return true
    } catch (error) {
      this.deps.logger.warn(
        { err: error, leadId: input.leadId },
        'census pick follow-up task not created',
      )
      return false
    }
  }

  async recordLeadActivity(input: {
    leadId: string
    title: string
    description: string
  }): Promise<void> {
    const activities = new ActivitiesService(this.ctx)
    const activity = await activities.create({
      type: 'note',
      title: input.title,
      description: input.description,
      entityType: 'lead',
      entityId: input.leadId,
      ownerId: null,
    })
    await activities.complete(activity.id)
  }
}

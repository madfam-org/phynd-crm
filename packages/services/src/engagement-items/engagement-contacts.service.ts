import { contacts, engagementContacts, engagements } from '@phynd/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError, ValidationError } from '../errors'

/**
 * Contacts of an engagement beyond its primary contact. portal_access = true
 * lets the contact open the client portal with a magic link sent to their own
 * email (see engagement-portal/portal-access.ts).
 */
export class EngagementContactsService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(engagementId: string) {
    return this.ctx.db
      .select({
        id: engagementContacts.id,
        engagementId: engagementContacts.engagementId,
        contactId: engagementContacts.contactId,
        role: engagementContacts.role,
        portalAccess: engagementContacts.portalAccess,
        name: contacts.name,
        email: contacts.email,
        preferredName: contacts.preferredName,
        spanishFormality: contacts.spanishFormality,
      })
      .from(engagementContacts)
      .innerJoin(contacts, eq(engagementContacts.contactId, contacts.id))
      .where(and(eq(engagementContacts.engagementId, engagementId), isNull(contacts.deletedAt)))
      .orderBy(asc(engagementContacts.createdAt))
  }

  /** Adds the contact to the engagement or updates its role / portal access. */
  async upsert(input: {
    engagementId: string
    contactId: string
    role?: string | null
    portalAccess?: boolean
  }) {
    await this.requireEngagement(input.engagementId)
    const [contact] = await this.ctx.db
      .select({ id: contacts.id, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.id, input.contactId), isNull(contacts.deletedAt)))
      .limit(1)
    if (!contact) throw new NotFoundError('Contact', input.contactId)
    const portalAccess = input.portalAccess ?? false
    if (portalAccess && !contact.email) {
      throw new ValidationError('A contact needs an email before it can open the portal')
    }
    const [row] = await this.ctx.db
      .insert(engagementContacts)
      .values({
        engagementId: input.engagementId,
        contactId: input.contactId,
        role: input.role ?? null,
        portalAccess,
      })
      .onConflictDoUpdate({
        target: [engagementContacts.engagementId, engagementContacts.contactId],
        set: { role: input.role ?? null, portalAccess, updatedAt: new Date() },
      })
      .returning()
    return row
  }

  async remove(engagementId: string, contactId: string) {
    const [row] = await this.ctx.db
      .delete(engagementContacts)
      .where(
        and(
          eq(engagementContacts.engagementId, engagementId),
          eq(engagementContacts.contactId, contactId),
        ),
      )
      .returning({ id: engagementContacts.id })
    if (!row) throw new NotFoundError('Engagement contact', contactId)
    return row
  }

  private async requireEngagement(engagementId: string) {
    const [row] = await this.ctx.db
      .select({ id: engagements.id })
      .from(engagements)
      .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
      .limit(1)
    if (!row) throw new NotFoundError('Engagement', engagementId)
  }
}

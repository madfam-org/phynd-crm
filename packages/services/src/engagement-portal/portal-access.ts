import { type SpanishFormality, contacts, engagementContacts, engagements } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'

/** The contact who opened the portal, and how to address them. */
export interface PortalViewer {
  contactId: string
  name: string
  preferredName: string | null
  spanishFormality: SpanishFormality | null
  isPrimary: boolean
}

export interface PortalEngagement {
  id: string
  contactId: string
  opportunityId: string | null
  projectName: string
  status: string
  company: string | null
}

export type PortalAccess =
  | { status: 'not_found' }
  | { status: 'denied'; engagement: PortalEngagement }
  | { status: 'granted'; engagement: PortalEngagement; viewer: PortalViewer }

type Db = ServiceContext['db']

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * Who may open an engagement's portal: its primary contact
 * (engagements.contact_id) and every engagement_contacts row with
 * portal_access = true. Deleted contacts never qualify. The match is on the
 * Janua-verified email, case- and whitespace-insensitive.
 */
export async function resolvePortalAccess(
  db: Db,
  engagementId: string,
  email: string,
): Promise<PortalAccess> {
  const [row] = await db
    .select({
      id: engagements.id,
      contactId: engagements.contactId,
      opportunityId: engagements.opportunityId,
      projectName: engagements.projectName,
      status: engagements.status,
      company: contacts.company,
      contactEmail: contacts.email,
      contactName: contacts.name,
      preferredName: contacts.preferredName,
      spanishFormality: contacts.spanishFormality,
      contactDeletedAt: contacts.deletedAt,
    })
    .from(engagements)
    .innerJoin(contacts, eq(engagements.contactId, contacts.id))
    .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
    .limit(1)

  if (!row) return { status: 'not_found' }
  const engagement: PortalEngagement = {
    id: row.id,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
    projectName: row.projectName,
    status: row.status,
    company: row.company,
  }
  const wanted = normalizeEmail(email)
  if (!wanted) return { status: 'denied', engagement }

  if (!row.contactDeletedAt && normalizeEmail(row.contactEmail) === wanted) {
    return {
      status: 'granted',
      engagement,
      viewer: {
        contactId: row.contactId,
        name: row.contactName,
        preferredName: row.preferredName ?? null,
        spanishFormality: row.spanishFormality ?? null,
        isPrimary: true,
      },
    }
  }

  const portalContacts = await db
    .select({
      contactId: contacts.id,
      contactEmail: contacts.email,
      contactName: contacts.name,
      preferredName: contacts.preferredName,
      spanishFormality: contacts.spanishFormality,
    })
    .from(engagementContacts)
    .innerJoin(contacts, eq(engagementContacts.contactId, contacts.id))
    .where(
      and(
        eq(engagementContacts.engagementId, engagementId),
        eq(engagementContacts.portalAccess, true),
        isNull(contacts.deletedAt),
      ),
    )

  const match = portalContacts.find((c) => normalizeEmail(c.contactEmail) === wanted)
  if (!match) return { status: 'denied', engagement }
  return {
    status: 'granted',
    engagement,
    viewer: {
      contactId: match.contactId,
      name: match.contactName,
      preferredName: match.preferredName ?? null,
      spanishFormality: match.spanishFormality ?? null,
      isPrimary: false,
    },
  }
}

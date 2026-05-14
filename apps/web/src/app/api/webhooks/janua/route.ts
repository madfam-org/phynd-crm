import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { CacheInvalidator } from '@phynd/federation'
import { createLogger } from '@phynd/logging'
import { ContactsService, createServiceContext } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:janua')

interface JanuaUserCreatedData {
  email?: string
  first_name?: string
  id?: string
  last_name?: string
  username?: string
}

type JanuaWebhookPayload = {
  data?: unknown
  event?: string
  type?: string
}

function getJanuaEventType(payload: JanuaWebhookPayload): string {
  return payload.type ?? payload.event ?? 'unknown'
}

function getUserCreatedData(payload: JanuaWebhookPayload): JanuaUserCreatedData | null {
  if (getJanuaEventType(payload) !== 'user.created' || !payload.data) return null
  return payload.data as JanuaUserCreatedData
}

function createJanuaContactService(cache: ReturnType<typeof getCacheManager>) {
  const db = getDb()
  const botAuth = {
    userId: 'system:janua-webhook',
    tenantId: DEFAULT_TENANT_ID,
    roles: ['admin'] as string[],
    scopes: ['*'] as string[],
    accessToken: 'internal:janua-webhook',
  }

  return new ContactsService(createServiceContext(db, cache, botAuth))
}

function contactNameFromJanuaUser(data: JanuaUserCreatedData): string {
  return (
    [data.first_name, data.last_name].filter(Boolean).join(' ') ||
    data.username ||
    data.email ||
    'Unknown'
  )
}

async function linkExistingEmailContact(
  contactsService: ContactsService,
  data: JanuaUserCreatedData & { id: string },
): Promise<boolean> {
  if (!data.email) return false

  const emailContact = await contactsService.getByEmail(data.email)
  if (!emailContact) return false

  await contactsService.update(emailContact.id, { externalJanuaId: data.id })
  logger.info(
    { contactId: emailContact.id, januaId: data.id },
    'Linked existing email contact to Janua user',
  )
  return true
}

async function syncUserCreatedContact(
  payload: JanuaWebhookPayload,
  cache: ReturnType<typeof getCacheManager>,
) {
  const data = getUserCreatedData(payload)
  if (!data) return

  if (!data.id) {
    logger.warn({ payload }, 'user.created event missing user id — skipping contact creation')
    return
  }

  const contactsService = createJanuaContactService(cache)
  const existing = await contactsService.getByJanuaId(data.id)
  if (existing) {
    logger.info({ januaId: data.id }, 'Contact already exists for Janua user — skipping')
    return
  }

  if (await linkExistingEmailContact(contactsService, { ...data, id: data.id })) return

  const contact = await contactsService.create({
    name: contactNameFromJanuaUser(data),
    email: data.email,
    externalJanuaId: data.id,
  })

  logger.info(
    { contactId: contact.id, januaId: data.id },
    'Created CRM contact from user.created webhook',
  )
}

export async function POST(req: Request) {
  const secret = process.env.JANUA_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  return handleWebhook(req, {
    secret,
    onEvent: async (payload) => {
      const cache = getCacheManager()
      const invalidator = new CacheInvalidator(cache)
      const eventType = getJanuaEventType(payload as JanuaWebhookPayload)

      // Always invalidate cache
      await invalidator.invalidate('janua', eventType, payload)
      await syncUserCreatedContact(payload as JanuaWebhookPayload, cache)
    },
  })
}

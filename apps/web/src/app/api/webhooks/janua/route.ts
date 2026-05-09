import { getCacheManager } from '@/lib/federation/clients'
import { handleWebhook } from '@/lib/webhooks/handler'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { CacheInvalidator } from '@phynd/federation'
import { createLogger } from '@phynd/logging'
import { ContactsService, createServiceContext } from '@phynd/services'
import { NextResponse } from 'next/server'

const logger = createLogger('web:webhook:janua')

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
      const eventType = (payload.type ?? payload.event ?? 'unknown') as string

      // Always invalidate cache
      await invalidator.invalidate('janua', eventType, payload)

      // Handle user.created → create CRM Contact
      if (eventType === 'user.created' && payload.data) {
        const data = payload.data as {
          id?: string
          email?: string
          first_name?: string
          last_name?: string
          username?: string
        }

        if (!data.id) {
          logger.warn({ payload }, 'user.created event missing user id — skipping contact creation')
          return
        }

        const db = getDb()
        const botAuth = {
          userId: 'system:janua-webhook',
          tenantId: DEFAULT_TENANT_ID,
          roles: ['admin'] as string[],
          scopes: ['*'] as string[],
          accessToken: 'internal:janua-webhook',
        }

        const ctx = createServiceContext(db, cache, botAuth)
        const contactsService = new ContactsService(ctx)

        // Check for existing contact with this Janua ID (idempotent)
        const existing = await contactsService.getByJanuaId(data.id)
        if (existing) {
          logger.info({ januaId: data.id }, 'Contact already exists for Janua user — skipping')
          return
        }

        // Check if a contact already exists by email (e.g. from newsletter/interest)
        // and link it to the Janua ID instead of creating a duplicate
        if (data.email) {
          const emailContact = await contactsService.getByEmail(data.email)
          if (emailContact) {
            await contactsService.update(emailContact.id, { externalJanuaId: data.id })
            logger.info(
              { contactId: emailContact.id, januaId: data.id },
              'Linked existing email contact to Janua user',
            )
            return
          }
        }

        const name =
          [data.first_name, data.last_name].filter(Boolean).join(' ') ||
          data.username ||
          data.email ||
          'Unknown'

        const contact = await contactsService.create({
          name,
          email: data.email,
          externalJanuaId: data.id,
        })

        logger.info(
          { contactId: contact.id, januaId: data.id },
          'Created CRM contact from user.created webhook',
        )
      }
    },
  })
}

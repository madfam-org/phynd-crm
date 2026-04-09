import { getDb } from '@phyne/db'
import { contacts, leads } from '@phyne/db/schema'
import { createLogger } from '@phyne/logging'
import { EmailService } from '@phyne/services/email'
import { buildUnsubscribeUrl } from '@phyne/services/email/unsubscribe-token'
import { welcomeEmail } from '@phyne/services/email/templates/welcome'
import { legalTipEmail } from '@phyne/services/email/templates/legal-tip'
import { trialInviteEmail } from '@phyne/services/email/templates/trial-invite'
import { lastChanceEmail } from '@phyne/services/email/templates/last-chance'
import type { Job } from 'bullmq'
import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { createRedisConnection } from '../queues'

const logger = createLogger('worker:email-drip')

export interface EmailDripData {
  leadId: string
  step: number
}

/**
 * Drip schedule:
 *   Step 0 — Day 0: Welcome email with relevant Tezca content
 *   Step 1 — Day 2: Legal tip based on domain
 *   Step 2 — Day 5: Trial invitation
 *   Step 3 — Day 14: Last chance re-engagement
 */
const DRIP_DELAYS_MS: Record<number, number> = {
  0: 0,
  1: 2 * 24 * 60 * 60 * 1000,
  2: 5 * 24 * 60 * 60 * 1000,
  3: 14 * 24 * 60 * 60 * 1000,
}

const MAX_STEP = 3

function extractDomain(source: string): string {
  // source looks like 'tezca_newsletter' or 'tezca_interest:labor'
  const match = source.match(/tezca_interest:(\w+)/)
  return match?.[1] ?? ''
}

export async function processEmailDrip(job: Job<EmailDripData>): Promise<void> {
  const { leadId, step } = job.data
  logger.info({ jobId: job.id, leadId, step }, `Processing drip step ${step}`)

  const db = getDb()

  // Fetch lead + contact email
  const leadRows = await db
    .select({
      contactId: leads.contactId,
      source: leads.source,
      unsubscribed: leads.unsubscribed,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)

  const lead = leadRows[0]
  if (!lead) {
    logger.warn({ leadId }, 'Lead not found — skipping drip')
    return
  }

  if (lead.unsubscribed) {
    logger.info({ leadId, step }, 'Lead unsubscribed — skipping drip')
    return
  }

  const contactRows = await db
    .select({ email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, lead.contactId!))
    .limit(1)

  const contact = contactRows[0]
  if (!contact?.email) {
    logger.warn({ leadId, contactId: lead.contactId }, 'Contact has no email — skipping drip')
    return
  }

  const domain = extractDomain(lead.source ?? '')
  const unsubscribeUrl = buildUnsubscribeUrl(leadId)

  // Build email for this step
  let email: { subject: string; html: string }
  switch (step) {
    case 0:
      email = welcomeEmail({ domain, unsubscribeUrl })
      break
    case 1:
      email = legalTipEmail({ domain, unsubscribeUrl })
      break
    case 2:
      email = trialInviteEmail({ unsubscribeUrl })
      break
    case 3:
      email = lastChanceEmail({ unsubscribeUrl })
      break
    default:
      logger.warn({ step }, 'Unknown drip step — skipping')
      return
  }

  // Send email
  const emailService = new EmailService()
  try {
    const result = await emailService.send({
      to: contact.email,
      subject: email.subject,
      html: email.html,
      unsubscribeUrl,
    })
    logger.info(
      { leadId, step, emailId: result?.id, to: contact.email },
      `Drip step ${step} sent successfully`,
    )
  } catch (err) {
    logger.error({ err, leadId, step }, `Failed to send drip step ${step}`)
    throw err // Let BullMQ retry
  }

  // Enqueue next step if applicable
  if (step < MAX_STEP) {
    const nextStep = step + 1
    const nextDelay = (DRIP_DELAYS_MS[nextStep] ?? 0) - (DRIP_DELAYS_MS[step] ?? 0)

    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
    const connection = createRedisConnection(redisUrl)
    const queue = new Queue('email-drip', { connection })

    await queue.add(
      'drip',
      { leadId, step: nextStep },
      {
        delay: nextDelay,
        jobId: `drip-${leadId}-step-${nextStep}`, // Dedup by lead + step
      },
    )
    await queue.close()

    logger.info(
      { leadId, nextStep, delayMs: nextDelay },
      `Enqueued drip step ${nextStep}`,
    )
  }
}

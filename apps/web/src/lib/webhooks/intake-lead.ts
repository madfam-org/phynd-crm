import type { Transaction } from '@phynd/services'
import { applyLeadIntakeDefaults } from '@phynd/services/leads/lead-intake-defaults'
import { resolveSystemTaskOwner } from './system-task-owner'

// The step every intake feed runs after it stores a new lead (G2): owner and
// "First contact" task. A lead keeps the contact's owner when the contact has
// one (the only routing rule there is), else gets the configured default owner
// (`PHYND_CRM_DEFAULT_TASK_OWNER_ID`). Synthetic/test leads get neither.

interface IntakeLogger {
  warn(fields: Record<string, unknown>, message: string): void
}

/** The database or a transaction: both open a (sub)transaction the same way. */
type IntakeDb = {
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>
}

export interface FinishIntakeLeadInput {
  leadId: string
  contactOwnerId: string | null | undefined
  /** Synthetic/test traffic: no owner, no task. */
  isTest?: boolean
  /** The prospect's name (or address), for the task title. */
  displayName: string
  /** The feed's own task title, when it has one. */
  title?: string
  description?: string
  /** Names the feed in the warning line (never personal data). */
  feed: string
}

/**
 * Owner and first-contact task for a new lead. Best effort: it runs in a
 * savepoint, so a failure rolls back only these writes, is logged, and the
 * lead stays stored. Returns the task's due date when one was opened.
 */
export async function finishIntakeLead(
  db: IntakeDb,
  logger: IntakeLogger,
  input: FinishIntakeLeadInput,
): Promise<{ ownerId: string | null; dueAt: Date | null } | null> {
  if (input.isTest) return null
  try {
    return await db.transaction(async (savepoint) => {
      const ownerId = await resolveSystemTaskOwner(savepoint, logger, {
        contactOwnerId: input.contactOwnerId,
        logContext: { task: 'lead_first_contact', feed: input.feed, lead_id: input.leadId },
      })
      const result = await applyLeadIntakeDefaults(
        { db: savepoint as never },
        {
          leadId: input.leadId,
          ownerId,
          displayName: input.displayName,
          title: input.title,
          description: input.description,
        },
      )
      return { ownerId: result.ownerId, dueAt: result.dueAt }
    })
  } catch (error) {
    logger.warn(
      { err: error, leadId: input.leadId, feed: input.feed },
      'lead owner / first-contact task not set',
    )
    return null
  }
}

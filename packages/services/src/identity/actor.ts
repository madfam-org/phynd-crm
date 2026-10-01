import type { AuthContext } from '@phynd/types/auth'
import { CrmUserNotLinkedError } from '../errors'

/**
 * The `users.id` to use for a foreign key to `users` (owner columns,
 * notifications) or a per-user read (`listMine`, notifications).
 *
 * - Signed-in Janua user: the linked `crmUserId`. Throws
 *   `CrmUserNotLinkedError` when the identity is not linked.
 * - Non-Janua principals (service tokens, worker `system`, demo and dev
 *   sessions) carry no `januaSub` and keep their fixed `userId`, as before.
 */
export function requireCrmUserId(auth: AuthContext): string {
  if (auth.crmUserId) return auth.crmUserId
  if (auth.januaSub !== undefined) throw new CrmUserNotLinkedError()
  return auth.userId
}

/**
 * The value stored in free-text "who did this" columns (`notes.author_id`,
 * `stage_transitions.transitioned_by`, `consent_audit.actor`, the `*_by` keys
 * of `engagement_events.metadata`, …).
 *
 * Convention: the linked `users.id` when there is one, otherwise the Janua
 * subject, otherwise the principal's own id (`service:selva`, `system`, …).
 * Never throws, so recording who acted never blocks an action.
 */
export function actorIdOf(auth: AuthContext): string {
  return auth.crmUserId || auth.januaSub || auth.userId
}

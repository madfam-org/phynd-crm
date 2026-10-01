import { CRM_USER_NOT_LINKED, CRM_USER_NOT_LINKED_MESSAGE } from '@phynd/types/auth'

/** Stable toast id so repeated failures update one toast instead of stacking. */
export const CRM_USER_NOT_LINKED_TOAST_ID = 'crm-user-not-linked'

export { CRM_USER_NOT_LINKED_MESSAGE }

/**
 * True for a tRPC error raised because the signed-in Janua identity has no
 * linked CRM user (server: `CrmUserNotLinkedError`, formatted as
 * `data.appCode = 'CRM_USER_NOT_LINKED'`).
 */
export function isCrmUserNotLinkedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const data = (err as { data?: unknown }).data
  if (!data || typeof data !== 'object') return false
  return (data as { appCode?: unknown }).appCode === CRM_USER_NOT_LINKED
}

/** Query retry policy: never retry a not-linked error, otherwise up to 3 times. */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  return !isCrmUserNotLinkedError(err) && failureCount < 3
}

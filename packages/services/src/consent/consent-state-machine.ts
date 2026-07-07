// ---------------------------------------------------------------------------
// Pure consent state machine (LFPDPPP Art. 8).
//
// States:
//   (none)                  — no record exists for (identifier, channel)
//   pending_double_opt_in   — capture happened, confirmation outstanding
//   granted                 — affirmative, evidenced consent
//   revoked                 — consent withdrawn; only an explicit re-grant or
//                             a fresh double-opt-in cycle can leave this state
//
// Suppression is NOT part of this machine — the suppression list is checked
// separately and always wins over any consent status.
// ---------------------------------------------------------------------------

export const CONSENT_CHANNELS = ['email', 'sms', 'whatsapp'] as const
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number]

export const CONSENT_STATUSES = ['granted', 'revoked', 'pending_double_opt_in'] as const
export type ConsentStatus = (typeof CONSENT_STATUSES)[number]

export const CONSENT_ACTIONS = [
  'grant',
  'revoke',
  'request_double_opt_in',
  'confirm_double_opt_in',
] as const
export type ConsentAction = (typeof CONSENT_ACTIONS)[number]

/** `null` current status means "no record exists yet". */
export type ConsentCurrentStatus = ConsentStatus | null

const TRANSITIONS: Record<'none' | ConsentStatus, Partial<Record<ConsentAction, ConsentStatus>>> = {
  none: {
    // Direct grant is allowed only for captures that carry their own
    // affirmative evidence (e.g. signed paper form, checkout checkbox with
    // stored snapshot). Double opt-in is the default path for web captures.
    grant: 'granted',
    request_double_opt_in: 'pending_double_opt_in',
    // Revoking with no record creates a revoked tombstone so the opt-out is
    // durable even when consent was never captured here.
    revoke: 'revoked',
  },
  pending_double_opt_in: {
    confirm_double_opt_in: 'granted',
    grant: 'granted',
    revoke: 'revoked',
    // Re-request re-issues a fresh token (idempotent state-wise)
    request_double_opt_in: 'pending_double_opt_in',
  },
  granted: {
    // Refreshing evidence keeps the granted state
    grant: 'granted',
    revoke: 'revoked',
    // Never downgrade an existing grant to pending — a new double-opt-in
    // request on a granted identifier is a no-op state-wise (invalid here;
    // callers should treat granted as final until revoked).
  },
  revoked: {
    // Re-capture after revocation requires a fresh affirmative action
    grant: 'granted',
    request_double_opt_in: 'pending_double_opt_in',
    // Idempotent repeat revocation
    revoke: 'revoked',
    // confirm_double_opt_in is invalid: a revocation kills outstanding tokens
  },
}

/**
 * Returns the next status for `action` applied to `current`, or `null` when
 * the transition is not allowed (e.g. confirming a token after revocation,
 * or requesting double opt-in on an already-granted record).
 */
export function nextConsentStatus(
  current: ConsentCurrentStatus,
  action: ConsentAction,
): ConsentStatus | null {
  return TRANSITIONS[current ?? 'none'][action] ?? null
}

export function isConsentChannel(value: string): value is ConsentChannel {
  return (CONSENT_CHANNELS as readonly string[]).includes(value)
}

export function isConsentAction(value: string): value is ConsentAction {
  return (CONSENT_ACTIONS as readonly string[]).includes(value)
}

/** Normalizes an email/phone identifier: trim + lowercase. */
export function normalizeConsentIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase()
}

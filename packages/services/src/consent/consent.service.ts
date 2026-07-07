import { consentAudit, consentRecords, contacts } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError, ValidationError } from '../errors'
import {
  type ConsentAction,
  type ConsentChannel,
  type ConsentStatus,
  isConsentChannel,
  nextConsentStatus,
  normalizeConsentIdentifier,
} from './consent-state-machine'
import {
  DOUBLE_OPT_IN_TTL_MS,
  generateDoubleOptInToken,
  hashDoubleOptInToken,
} from './double-opt-in-token'
import { SuppressionService } from './suppression.service'

export type ConsentRecord = typeof consentRecords.$inferSelect

export type CaptureConsentInput = {
  identifier: string
  channel: ConsentChannel
  action: ConsentAction
  source: string
  evidence?: string
  contactId?: string
  actor?: string
  metadata?: Record<string, unknown>
}

export type CaptureConsentResult = {
  record: ConsentRecord
  /** Present only when `action` was `request_double_opt_in`. */
  doubleOptIn?: { token: string; expiresAt: Date }
}

export type ConsentPermission = {
  identifier: string
  channel: ConsentChannel
  consentStatus: ConsentStatus | null
  suppressed: boolean
  suppressionReasons: string[]
  /** True only when consent is granted AND the identifier is not suppressed. */
  permitted: boolean
}

function issueDoubleOptIn(
  action: ConsentAction,
  now: Date,
): {
  tokenHash: string | null
  tokenExpiresAt: Date | null
  doubleOptIn?: CaptureConsentResult['doubleOptIn']
} {
  if (action !== 'request_double_opt_in') {
    return { tokenHash: null, tokenExpiresAt: null }
  }
  const generated = generateDoubleOptInToken()
  const tokenExpiresAt = new Date(now.getTime() + DOUBLE_OPT_IN_TTL_MS)
  return {
    tokenHash: generated.tokenHash,
    tokenExpiresAt,
    doubleOptIn: { token: generated.token, expiresAt: tokenExpiresAt },
  }
}

function resolveConsentTimestamps(
  newStatus: ConsentStatus,
  currentStatus: ConsentStatus | null,
  existing: ConsentRecord | null,
  now: Date,
): { grantedAt: Date | null; revokedAt: Date | null } {
  // A (re-)grant refreshes grantedAt when transitioning into granted
  const grantedAt =
    newStatus === 'granted'
      ? currentStatus === 'granted'
        ? (existing?.grantedAt ?? now)
        : now
      : (existing?.grantedAt ?? null)
  return { grantedAt, revokedAt: newStatus === 'revoked' ? now : null }
}

/**
 * Channel-scoped marketing consent (LFPDPPP Art. 8) with double opt-in and a
 * full audit trail. Suppression (SuppressionService) always wins over any
 * consent status — see `checkPermission`.
 */
export class ConsentService {
  constructor(private readonly ctx: ServiceContext) {}

  async getConsent(identifier: string, channel: ConsentChannel): Promise<ConsentRecord | null> {
    const normalized = normalizeConsentIdentifier(identifier)
    const [record] = await this.ctx.db
      .select()
      .from(consentRecords)
      .where(and(eq(consentRecords.identifier, normalized), eq(consentRecords.channel, channel)))
      .limit(1)
    return record ?? null
  }

  async listForContact(contactId: string): Promise<ConsentRecord[]> {
    return this.ctx.db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.contactId, contactId))
      .orderBy(consentRecords.channel)
  }

  /**
   * Applies a consent transition. Invalid transitions (per the state
   * machine) throw ValidationError. For `request_double_opt_in` the raw
   * confirmation token is returned so the caller can deliver it — only its
   * hash is persisted.
   */
  async capture(input: CaptureConsentInput): Promise<CaptureConsentResult> {
    const identifier = normalizeConsentIdentifier(input.identifier)
    if (!identifier) {
      throw new ValidationError('Consent identifier is required')
    }
    if (!isConsentChannel(input.channel)) {
      throw new ValidationError(`Invalid consent channel: ${input.channel}`)
    }
    if (!input.source) {
      throw new ValidationError('Consent source is required')
    }

    const existing = await this.getConsent(identifier, input.channel)
    const currentStatus = (existing?.status as ConsentStatus | undefined) ?? null
    const newStatus = nextConsentStatus(currentStatus, input.action)
    if (!newStatus) {
      throw new ValidationError(
        `Invalid consent transition: ${input.action} from ${currentStatus ?? 'none'}`,
      )
    }

    const now = new Date()
    const issued = issueDoubleOptIn(input.action, now)
    const doubleOptIn = issued.doubleOptIn

    const contactId =
      input.contactId ??
      existing?.contactId ??
      (input.channel === 'email' ? await this.findContactIdByEmail(identifier) : null)

    const values = {
      identifier,
      channel: input.channel,
      status: newStatus,
      source: input.source,
      evidence: input.evidence ?? null,
      contactId,
      // A revocation (or a fresh grant) invalidates any outstanding token.
      doubleOptInTokenHash: issued.tokenHash,
      doubleOptInExpiresAt: issued.tokenExpiresAt,
      ...resolveConsentTimestamps(newStatus, currentStatus, existing, now),
      metadata: input.metadata ?? existing?.metadata ?? {},
    }

    const record = await this.ctx.db.transaction(async (tx) => {
      let row: ConsentRecord | undefined
      if (existing) {
        const [updated] = await tx
          .update(consentRecords)
          .set(values)
          .where(eq(consentRecords.id, existing.id))
          .returning()
        row = updated
      } else {
        const [inserted] = await tx.insert(consentRecords).values(values).returning()
        row = inserted
      }
      if (!row) {
        throw new ValidationError('Consent record write failed')
      }

      await tx.insert(consentAudit).values({
        consentRecordId: row.id,
        action: input.action,
        previousStatus: currentStatus,
        newStatus,
        source: input.source,
        evidence: input.evidence ?? null,
        actor: input.actor ?? this.ctx.auth.userId ?? null,
      })

      return row
    })

    return { record, doubleOptIn }
  }

  /**
   * Double-opt-in confirmation endpoint backing. The raw token is the
   * credential — no session required. Confirming an already-granted record
   * with its (still stored) token is an idempotent success.
   */
  async confirmDoubleOptIn(
    token: string,
    options?: { actor?: string },
  ): Promise<{ record: ConsentRecord; alreadyConfirmed: boolean }> {
    const tokenHash = hashDoubleOptInToken(token)
    const [record] = await this.ctx.db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.doubleOptInTokenHash, tokenHash))
      .limit(1)

    if (!record) {
      throw new NotFoundError('ConsentRecord', 'double-opt-in token')
    }

    if (record.status === 'granted') {
      return { record, alreadyConfirmed: true }
    }

    if (record.status !== 'pending_double_opt_in') {
      throw new ValidationError('Consent is no longer pending confirmation')
    }
    if (record.doubleOptInExpiresAt && record.doubleOptInExpiresAt.getTime() < Date.now()) {
      throw new ValidationError('Double opt-in token expired')
    }

    const now = new Date()
    const updated = await this.ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .update(consentRecords)
        .set({ status: 'granted', grantedAt: now, revokedAt: null })
        .where(eq(consentRecords.id, record.id))
        .returning()

      await tx.insert(consentAudit).values({
        consentRecordId: record.id,
        action: 'confirm_double_opt_in',
        previousStatus: record.status,
        newStatus: 'granted',
        source: record.source,
        evidence: 'Double opt-in link confirmed',
        actor: options?.actor ?? 'subject',
      })

      return row
    })

    return { record: updated ?? { ...record, status: 'granted' }, alreadyConfirmed: false }
  }

  /**
   * Combined permission check: suppression first (it always wins), then the
   * channel consent record. Legacy fallback to `contacts.marketingConsent`
   * is handled by the campaign send gate, not here — this reflects only the
   * explicit consent model.
   */
  async checkPermission(identifier: string, channel: ConsentChannel): Promise<ConsentPermission> {
    const normalized = normalizeConsentIdentifier(identifier)
    const suppressionService = new SuppressionService(this.ctx)
    const [suppression, record] = [
      await suppressionService.check(normalized, channel),
      await this.getConsent(normalized, channel),
    ]

    const consentStatus = (record?.status as ConsentStatus | undefined) ?? null
    return {
      identifier: normalized,
      channel,
      consentStatus,
      suppressed: suppression.suppressed,
      suppressionReasons: suppression.entries.map((entry) => entry.reason),
      permitted: !suppression.suppressed && consentStatus === 'granted',
    }
  }

  private async findContactIdByEmail(email: string): Promise<string | null> {
    const [contact] = await this.ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.email, email), isNull(contacts.deletedAt)))
      .limit(1)
    return contact?.id ?? null
  }
}

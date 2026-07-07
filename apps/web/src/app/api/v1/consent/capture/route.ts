import { resolveTenantIdForWebhook } from '@/lib/webhooks/engagement-writer'
import { parseSignedWebhookRequest } from '@/lib/webhooks/handler'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  type CaptureConsentResult,
  type ConsentAction,
  type ConsentChannel,
  ConsentService,
  EmailService,
  buildConsentConfirmUrl,
  createServiceContext,
  isConsentAction,
  isConsentChannel,
} from '@phynd/services'
import { consentConfirmEmail } from '@phynd/services/email/templates/consent-confirm'
import { ValidationError } from '@phynd/services/errors'
import { NextResponse } from 'next/server'

const logger = createLogger('web:consent-capture')

type CapturePayload = {
  identifier: string
  channel: ConsentChannel
  action: ConsentAction
  source: string
  evidence?: string
  contactId?: string
  sendConfirmationEmail: boolean
  metadata?: Record<string, unknown>
}

function parseCapturePayload(
  payload: Record<string, unknown>,
): { ok: true; input: CapturePayload } | { ok: false; error: string } {
  const channel = payload.channel as string | undefined
  const action = payload.action as string | undefined
  const source = payload.source as string | undefined
  const identifier =
    channel === 'email'
      ? (payload.email as string | undefined)
      : ((payload.phone as string | undefined) ?? (payload.email as string | undefined))

  if (!channel || !isConsentChannel(channel)) {
    return { ok: false, error: 'Invalid or missing channel' }
  }
  if (!action || !isConsentAction(action) || action === 'confirm_double_opt_in') {
    // Confirmation happens via GET /api/consent/confirm (token-authenticated)
    return { ok: false, error: 'Invalid or missing action' }
  }
  if (!source) {
    return { ok: false, error: 'Missing source' }
  }
  if (!identifier) {
    return { ok: false, error: 'Missing email/phone identifier' }
  }

  return {
    ok: true,
    input: {
      identifier,
      channel,
      action,
      source,
      evidence: payload.evidence as string | undefined,
      contactId: (payload.contact_id as string | undefined) ?? undefined,
      sendConfirmationEmail: payload.send_confirmation_email !== false,
      metadata: (payload.metadata as Record<string, unknown> | undefined) ?? undefined,
    },
  }
}

async function maybeSendConfirmationEmail(
  input: CapturePayload,
  result: CaptureConsentResult,
): Promise<boolean> {
  if (!result.doubleOptIn || input.channel !== 'email' || !input.sendConfirmationEmail) {
    return false
  }
  const confirmUrl = buildConsentConfirmUrl(result.doubleOptIn.token)
  const email = consentConfirmEmail({ confirmUrl, sourceLabel: input.source.split('_')[0] })
  try {
    const sent = await new EmailService().send({
      to: input.identifier,
      subject: email.subject,
      html: email.html,
    })
    return Boolean(sent)
  } catch (err) {
    // Consent capture stays recorded even when the confirm email fails; the
    // caller can re-request double opt-in to re-issue a token.
    logger.error({ err, source: input.source }, 'double-opt-in confirmation email failed')
    return false
  }
}

// Cross-product marketing-consent capture (LFPDPPP Art. 8) — called by the
// consent components on dhanam/karafiel/tezca. Contract: docs/CONSENT_API.md.
//
// Expected payload:
//   {
//     email?: string,            // required for channel=email
//     phone?: string,            // required for channel=sms|whatsapp (E.164)
//     channel: 'email' | 'sms' | 'whatsapp',
//     action: 'grant' | 'revoke' | 'request_double_opt_in',
//     source: string,            // e.g. 'dhanam_signup_form'
//     evidence?: string,         // consent copy shown, form snapshot, IP…
//     contact_id?: string,
//     send_confirmation_email?: boolean,  // default true (email channel)
//     metadata?: object
//   }
//
// Secret: PHYND_CONSENT_EVENTS_SECRET (HMAC, shared with the calling product).
export async function POST(req: Request) {
  const secret = process.env.PHYND_CONSENT_EVENTS_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Consent events secret not configured' }, { status: 503 })
  }

  const parsed = await parseSignedWebhookRequest(req, secret)
  if (!parsed.ok) {
    return parsed.response
  }

  const payloadResult = parseCapturePayload(parsed.payload)
  if (!payloadResult.ok) {
    return NextResponse.json({ error: payloadResult.error }, { status: 400 })
  }
  const input = payloadResult.input

  try {
    const tenantId = resolveTenantIdForWebhook(req)
    const db = getDb(tenantId)
    const service = new ConsentService(
      createServiceContext(db, {} as never, {
        userId: `service:${input.source}`,
        tenantId,
        roles: ['service'],
        scopes: ['consent:write'],
        accessToken: '',
      }),
    )

    const result = await service.capture({
      identifier: input.identifier,
      channel: input.channel,
      action: input.action,
      source: input.source,
      evidence: input.evidence,
      contactId: input.contactId,
      actor: `service:${input.source}`,
      metadata: input.metadata,
    })

    const confirmationEmailSent = await maybeSendConfirmationEmail(input, result)

    logger.info(
      {
        channel: input.channel,
        action: input.action,
        source: input.source,
        status: result.record.status,
        confirmationEmailSent,
      },
      'consent capture processed',
    )

    return NextResponse.json(
      {
        consent: {
          identifier: result.record.identifier,
          channel: result.record.channel,
          status: result.record.status,
        },
        ...(result.doubleOptIn && {
          double_opt_in: {
            expires_at: result.doubleOptIn.expiresAt.toISOString(),
            confirmation_email_sent: confirmationEmailSent,
            // Raw confirm URL is returned so products that send their own
            // branded confirmation email can embed it. Treat as a secret.
            confirm_url: buildConsentConfirmUrl(result.doubleOptIn.token),
          },
        }),
      },
      { headers: { 'X-RateLimit-Remaining': String(parsed.remaining) } },
    )
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    logger.error({ err: error }, 'consent capture failed')
    return NextResponse.json({ error: 'Consent capture failed' }, { status: 500 })
  }
}

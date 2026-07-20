import { Resend } from 'resend'
import { injectPreheader } from './preheader'

/**
 * The sender identity outbound mail will actually carry. MADFAM is the
 * neutral multi-product default; prod sets EMAIL_FROM explicitly. Exported so
 * the campaign-authorization snapshot can show the owner the real FROM (and
 * so a later EMAIL_FROM change invalidates a stale authorization via hash
 * drift). Read per call — not captured at module load.
 */
export function resolveSenderIdentity(): string {
  return process.env.EMAIL_FROM ?? 'MADFAM <noreply@madfam.io>'
}

let resendClient: Resend | null = null

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  if (!resendClient) {
    resendClient = new Resend(apiKey)
  }
  return resendClient
}

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  /**
   * Preview text shown after the subject in inbox list views. Rendered as a
   * hidden div right after <body> (standard hidden-preheader pattern).
   * Omitted cleanly when not provided.
   */
  preheader?: string
  unsubscribeUrl?: string
  /**
   * Resend tags — echoed back in webhook events (email.opened /
   * email.clicked …) so opens/clicks can be attributed to a campaign, lead,
   * or contact. Values may only contain ASCII letters, numbers, underscores,
   * or dashes (UUIDs are fine).
   */
  tags?: { name: string; value: string }[]
}

export class EmailService {
  async send(params: SendEmailParams): Promise<{ id: string } | null> {
    const resend = getResend()
    if (!resend) {
      console.warn('RESEND_API_KEY not configured — email skipped')
      return null
    }

    const { data, error } = await resend.emails.send({
      from: resolveSenderIdentity(),
      to: params.to,
      subject: params.subject,
      html: injectPreheader(params.html, params.preheader),
      ...(params.tags?.length && { tags: params.tags }),
      ...(params.unsubscribeUrl && {
        headers: {
          'List-Unsubscribe': `<${params.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    })

    if (error) {
      throw new Error(`Resend error: ${error.message}`)
    }

    return data
  }
}

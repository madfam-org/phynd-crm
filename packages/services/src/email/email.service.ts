import { Resend } from 'resend'

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'Tezca <noreply@janua.dev>'

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
}

export class EmailService {
  async send(params: SendEmailParams): Promise<{ id: string } | null> {
    const resend = getResend()
    if (!resend) {
      console.warn('RESEND_API_KEY not configured — email skipped')
      return null
    }

    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: params.to,
      subject: params.subject,
      html: params.html,
    })

    if (error) {
      throw new Error(`Resend error: ${error.message}`)
    }

    return data
  }
}

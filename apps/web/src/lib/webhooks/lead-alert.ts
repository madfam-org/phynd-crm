import { createLogger } from '@phynd/logging'
import { EmailService, LeadsService, type ServiceContext } from '@phynd/services'
import type { LeadTier } from '@phynd/types/crm'

// The one "new lead" alert every intake feed sends (Avala, Nauta, Kalya, the
// public site, the quoting platform, ceq, tezca): one email per new real lead
// to the people who answer prospects. Ruling V8 (2026-11-15): `hola@madfam.io`
// is the conversation and sales inbox, so it is the default recipient;
// `LEADS_NOTIFY_EMAIL` (comma-separated) overrides it.
//
// The subject and the inbox preview carry the feed and the tier only, never
// the prospect's name, address, company or words. Feeds that already sent a
// detailed body (lead-intake, nauta) pass it as `detailsHtml`; it goes in the
// body, below the feed and tier.
//
// Best effort by design: it runs after the lead is stored, and neither a
// missing key nor a provider error may fail the webhook (the sender would
// retry a lead that already exists). Test leads (`leads.is_test`) get no
// alert.

const logger = createLogger('web:webhook:lead-alert')

/** Ruling V8: `hola@` is for conversation and sales. */
export const DEFAULT_LEADS_NOTIFY_EMAIL = 'hola@madfam.io'

/**
 * Email links always target the canonical host, never NEXT_PUBLIC_APP_URL
 * (baked at build time, once pointed at a retired domain) or the request host.
 */
export const CRM_BASE_URL = 'https://crm.madfam.io'

/** Who is told about a new lead: `LEADS_NOTIFY_EMAIL`, else `hola@madfam.io`. */
export function leadAlertRecipients(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const recipients = (env.LEADS_NOTIFY_EMAIL ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  return recipients.length > 0 ? recipients : [DEFAULT_LEADS_NOTIFY_EMAIL]
}

/** The lead's page in the CRM, or the leads list while there is no lead id. */
export function leadAlertUrl(leadId: string | null): string {
  return leadId ? `${CRM_BASE_URL}/leads/${encodeURIComponent(leadId)}` : `${CRM_BASE_URL}/leads`
}

export interface LeadAlert {
  /** The feed, as a tag value: `avala`, `nauta`, `kalya`, `madfam-site`, `cotiza`, `ceq`, `tezca`. */
  feed: string
  /** How staff read the source, e.g. «Avala · producto-comply». Never personal data. */
  sourceLabel: string
  leadId: string | null
  contactId: string
  /** A | B | C; null while the lead has no score. */
  tier: LeadTier | null | undefined
  /** Synthetic or test traffic: no alert. */
  isTest: boolean
  /** Extra body HTML from feeds with a detailed notification (already escaped). */
  detailsHtml?: string
}

export function escapeHtml(value: string | undefined): string {
  return (value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function tierLabel(tier: LeadTier | null | undefined): string {
  return tier ? `Tier ${tier}` : 'Tier sin calcular'
}

/** «Nuevo lead · Avala · producto-comply · Tier A». No personal data. */
export function leadAlertSubject(
  alert: Pick<LeadAlert, 'sourceLabel' | 'tier'>,
  env: Record<string, string | undefined> = process.env,
): string {
  const prefix = env.PHYND_DEPLOYMENT_TIER === 'staging' ? '[staging] ' : ''
  return `${prefix}Nuevo lead · ${alert.sourceLabel} · ${tierLabel(alert.tier)}`
}

export function leadAlertHtml(alert: LeadAlert): string {
  const row = (label: string, value: string): string =>
    `<tr><td style="padding:6px 12px 6px 0;color:#5a6a7a;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`
  return [
    '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a232e">',
    `<h2 style="margin:0 0 12px">Nuevo lead — ${escapeHtml(alert.sourceLabel)}</h2>`,
    '<table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 12px">',
    row('Origen', alert.sourceLabel),
    row('Tier', alert.tier ?? 'sin calcular'),
    '</table>',
    alert.detailsHtml ?? '',
    `<p style="margin:20px 0"><a href="${leadAlertUrl(alert.leadId)}" style="background:#2e6db4;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Abrir en el CRM</a></p>`,
    '</div>',
  ].join('')
}

/**
 * The lead's tier as scored at creation (`LeadsService.create` scores it), or
 * null when it is not scored or cannot be read. Never throws.
 */
export async function leadTierOf(ctx: ServiceContext, leadId: string): Promise<LeadTier | null> {
  try {
    const lead = await new LeadsService(ctx).getById(leadId)
    const tier = lead?.tier
    return tier === 'A' || tier === 'B' || tier === 'C' ? tier : null
  } catch (error) {
    logger.warn({ err: error, leadId }, 'lead tier not read for the alert')
    return null
  }
}

/**
 * Sends the alert for one new lead. Returns whether a message was handed to
 * the provider. Never throws.
 */
export async function sendLeadAlert(alert: LeadAlert): Promise<boolean> {
  if (alert.isTest) return false
  const recipients = leadAlertRecipients()

  try {
    const sent = await new EmailService().send({
      to: recipients.join(','),
      subject: leadAlertSubject(alert),
      html: leadAlertHtml(alert),
      preheader: `${tierLabel(alert.tier)} · ${alert.sourceLabel}`,
      tags: [
        { name: 'source', value: alert.feed },
        ...(alert.leadId ? [{ name: 'lead_id', value: alert.leadId }] : []),
        { name: 'contact_id', value: alert.contactId },
      ],
    })
    logger.info(
      {
        leadId: alert.leadId,
        feed: alert.feed,
        tier: alert.tier ?? null,
        resendId: sent?.id ?? null,
      },
      'lead alert sent',
    )
    return true
  } catch (error) {
    logger.error({ err: error, leadId: alert.leadId, feed: alert.feed }, 'lead alert failed')
    return false
  }
}

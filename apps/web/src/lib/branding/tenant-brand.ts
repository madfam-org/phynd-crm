export type TenantBrand = {
  host: string
  tenantId: string
  productName: string
  navName: string
  title: string
  description: string
  heroPrefix: string
  heroHighlight: string
  heroDescription: string
  badges: string[]
  primaryCta: string
  secondaryCta: string
  poweredBy?: string
  ogUrl: string
}

const phyndBrand: TenantBrand = {
  host: 'phynd.app',
  tenantId: 'phynd',
  productName: 'Phynd',
  navName: 'Phynd',
  title: 'Phynd - The CRM Built for Physical + Digital',
  description:
    'Phynd federates real-time data from your entire ecosystem into one unified CRM. No data duplication. No vendor lock-in. No per-seat pricing.',
  heroPrefix: 'The CRM Built for',
  heroHighlight: 'Physical + Digital',
  heroDescription:
    'Phynd federates real-time data from your entire ecosystem into one unified view. No data duplication. No vendor lock-in. No per-seat pricing.',
  badges: ['Open Source', 'Self-Hostable', 'MIT Licensed'],
  primaryCta: 'Get Started Free',
  secondaryCta: 'Try Live Demo',
  ogUrl: 'https://phynd.app',
}

const madfamBrand: TenantBrand = {
  host: 'crm.madfam.io',
  tenantId: 'madfam',
  productName: 'MADFAM CRM',
  navName: 'MADFAM CRM',
  title: 'MADFAM CRM - Client Portal powered by Phynd',
  description:
    'MADFAM-labelled PhyndCRM portal for client relationships, project fulfillment, quotes, payments, and phygital delivery status.',
  heroPrefix: 'MADFAM client CRM for',
  heroHighlight: 'Phygital Fulfillment',
  heroDescription:
    'crm.madfam.io is the MADFAM-labelled PhyndCRM slice: a Janua-powered client portal for real relationships, fulfillment status, quotes, payments, and ecosystem delivery data.',
  badges: ['MADFAM Tenant', 'Powered by Phynd', 'Janua SSO'],
  primaryCta: 'Enter MADFAM CRM',
  secondaryCta: 'View Portal Demo',
  poweredBy: 'Powered by PhyndCRM',
  ogUrl: 'https://crm.madfam.io',
}

export function normalizeHost(host: string | null | undefined): string {
  return (host ?? '').split(',')[0]?.trim().toLowerCase().replace(/:\d+$/, '') ?? ''
}

export function getBrandForHost(host: string | null | undefined): TenantBrand {
  const normalized = normalizeHost(host)
  if (normalized === 'crm.madfam.io') return madfamBrand
  return phyndBrand
}

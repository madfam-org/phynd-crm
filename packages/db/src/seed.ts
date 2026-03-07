import { getDb } from './client'
import { contacts } from './schema/contacts'
import { leads } from './schema/leads'
import { opportunities } from './schema/opportunities'
import { pipelineStages, pipelines } from './schema/pipelines'
import { roleViewPreferences } from './schema/role-preferences'

async function seed() {
  const db = getDb()

  console.log('Seeding database...')

  // Create default pipeline
  const [defaultPipeline] = await db
    .insert(pipelines)
    .values({ name: 'Default Sales Pipeline', isDefault: true })
    .returning()

  // Create pipeline stages
  const stageData = [
    { name: 'Prospecting', position: 0, probability: 10 },
    { name: 'Qualification', position: 1, probability: 20 },
    { name: 'Proposal', position: 2, probability: 50 },
    { name: 'Negotiation', position: 3, probability: 75 },
    { name: 'Closed Won', position: 4, probability: 100 },
    { name: 'Closed Lost', position: 5, probability: 0 },
  ]

  const stages = await db
    .insert(pipelineStages)
    .values(stageData.map((s) => ({ ...s, pipelineId: defaultPipeline!.id })))
    .returning()

  // Create sample contacts
  const sampleContacts = await db
    .insert(contacts)
    .values([
      { name: 'Alice Johnson', email: 'alice@example.com', company: 'TechCorp', status: 'active' },
      { name: 'Bob Smith', email: 'bob@example.com', company: 'DesignLab', status: 'active' },
      { name: 'Carol White', email: 'carol@example.com', company: 'MfgWorks', status: 'active' },
    ])
    .returning()

  // Create sample leads
  await db.insert(leads).values([
    {
      contactId: sampleContacts[0]!.id,
      source: 'website',
      status: 'qualified',
      score: 85,
      pipelineId: defaultPipeline!.id,
      stageId: stages[2]!.id,
    },
    {
      contactId: sampleContacts[1]!.id,
      source: 'referral',
      status: 'new',
      score: 60,
      pipelineId: defaultPipeline!.id,
      stageId: stages[0]!.id,
    },
  ])

  // Create sample opportunity
  await db.insert(opportunities).values([
    {
      name: 'TechCorp Enterprise Deal',
      contactId: sampleContacts[0]!.id,
      pipelineId: defaultPipeline!.id,
      stageId: stages[2]!.id,
      value: '50000.00',
      probability: 50,
      status: 'open',
    },
  ])

  // Create default role view preferences
  await db.insert(roleViewPreferences).values([
    {
      role: 'sales_rep',
      panelOrder: ['identity', 'billing', 'manufacturing', 'fabrication', 'assets'],
      defaultTab: 'identity',
    },
    {
      role: 'manufacturing',
      panelOrder: ['manufacturing', 'fabrication', 'assets', 'identity', 'billing'],
      defaultTab: 'manufacturing',
    },
    {
      role: 'finance',
      panelOrder: ['billing', 'identity', 'manufacturing', 'fabrication', 'assets'],
      defaultTab: 'billing',
    },
    {
      role: 'admin',
      panelOrder: ['identity', 'billing', 'manufacturing', 'fabrication', 'assets'],
      defaultTab: 'identity',
    },
  ])

  console.log('Seed complete!')
  process.exit(0)
}

seed().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})

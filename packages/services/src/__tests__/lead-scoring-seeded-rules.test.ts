import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeadScoringService } from '../lead-scoring/lead-scoring.service'
import { SEEDED_SCORING_RULES, type SeededScoringRule } from '../lead-scoring/seeded-rules'
import { type MockDatabase, createTestContext, makeLead } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      _tag: 'sql',
      strings,
      values,
    })),
    { join: vi.fn() },
  ),
}))

vi.mock('@phynd/db/schema', () => ({
  contacts: { id: 'contacts.id', email: 'contacts.email', phone: 'contacts.phone' },
  leadScores: { id: 'leadScores.id', leadId: 'leadScores.leadId' },
  leadScoringRules: { id: 'leadScoringRules.id', isActive: 'leadScoringRules.isActive' },
  leads: {
    id: 'leads.id',
    contactId: 'leads.contactId',
    createdAt: 'leads.createdAt',
    deletedAt: 'leads.deletedAt',
    isTest: 'leads.isTest',
  },
  visitorPageViews: { sessionId: 'visitorPageViews.sessionId', url: 'visitorPageViews.url' },
  visitorSessions: {
    contactId: 'visitorSessions.contactId',
    id: 'visitorSessions.id',
    pageViewCount: 'visitorSessions.pageViewCount',
  },
}))

const DAY = 24 * 60 * 60 * 1000

interface Scenario {
  lead?: Record<string, unknown>
  contact?: { email: string | null; phone: string | null }
  repeats?: number
}

/**
 * Feeds the scoring queries in order: lead, rules, visitor sessions, session
 * ids, then the contact and the repeat count when a rule needs them, then the
 * score upsert. Returns the tier and score written on the lead row.
 */
async function score(
  db: MockDatabase,
  service: LeadScoringService,
  rules: readonly SeededScoringRule[],
  scenario: Scenario,
) {
  const lead = makeLead({
    contactId: 'contact-001',
    createdAt: new Date(),
    ...scenario.lead,
  })
  const ruleRows = rules.map((rule) => ({ ...rule, isActive: true }))
  const fields = JSON.stringify(rules.map((rule) => rule.condition))
  const responses: unknown[][] = [[lead], ruleRows, [{ count: 0, pageViews: 0 }], []]
  if (fields.includes('email_free_mail') || fields.includes('has_phone')) {
    responses.push([scenario.contact ?? { email: null, phone: null }])
  }
  if (fields.includes('repeat_submissions_7d')) responses.push([{ count: scenario.repeats ?? 0 }])
  responses.push([], [{ id: 'score-001' }], [])

  db._qb.set.mockClear()
  db._qb.then.mockImplementation((resolve: (v: unknown) => void) =>
    Promise.resolve(responses.shift() ?? []).then(resolve),
  )
  await service.computeScore(lead.id)

  const written = db._qb.set.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .find((values) => 'tier' in values)
  return written as { score: number; tier: string | null }
}

function rule(id: string): SeededScoringRule {
  const found = SEEDED_SCORING_RULES.find((candidate) => candidate.id.endsWith(id))
  if (!found) throw new Error(`no seeded rule ${id}`)
  return found
}

describe('seeded scoring rules', () => {
  let service: LeadScoringService
  let db: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    db = ctx.mockDb
    service = new LeadScoringService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('intent: sales request +4', async () => {
    const r = [rule('01')]
    expect(
      (await score(db, service, r, { lead: { attribution: { intent: 'sales-request' } } })).score,
    ).toBe(4)
    expect(
      (await score(db, service, r, { lead: { attribution: { intent: 'waitlist' } } })).score,
    ).toBe(0)
  })

  it('intent: request access +2, +1 more from a demo or Comply page', async () => {
    const r = [rule('02'), rule('03')]
    const attribution = { intent: 'request-access' }
    expect(
      (await score(db, service, r, { lead: { attribution, source: 'marketing-nav' } })).score,
    ).toBe(2)
    expect(
      (await score(db, service, r, { lead: { attribution, source: 'producto-comply' } })).score,
    ).toBe(3)
    expect(
      (await score(db, service, r, { lead: { attribution, source: 'demo-home' } })).score,
    ).toBe(3)
  })

  it('intent: waitlist +1 and always tier C', async () => {
    const result = await score(db, service, SEEDED_SCORING_RULES, {
      lead: { attribution: { intent: 'waitlist', interests: ['DC3'] } },
      contact: { email: 'ana@empresa-ficticia.mx', phone: '+52 55 0000 0000' },
      repeats: 2,
    })
    expect(result.score).toBe(7)
    expect(result.tier).toBe('C')
  })

  it('fit: a company domain +2, a free-mail address nothing', async () => {
    const r = [rule('05')]
    expect(
      (await score(db, service, r, { contact: { email: 'ana@empresa-ficticia.mx', phone: null } }))
        .score,
    ).toBe(2)
    expect(
      (await score(db, service, r, { contact: { email: 'ana@gmail.com', phone: null } })).score,
    ).toBe(0)
    expect((await score(db, service, r, { contact: { email: null, phone: null } })).score).toBe(0)
  })

  it('fit: interests include dc3 or compliance +1 (any letter case)', async () => {
    const r = [rule('06')]
    expect(
      (await score(db, service, r, { lead: { attribution: { interests: ['Compliance'] } } })).score,
    ).toBe(1)
    expect(
      (await score(db, service, r, { lead: { attribution: { interests: ['other'] } } })).score,
    ).toBe(0)
  })

  it('recency: -1 after 30 days and -1 more after 60, never below 0 on the lead', async () => {
    const r = [rule('01'), rule('07'), rule('08')]
    const attribution = { intent: 'sales-request' }
    const at = (days: number) => new Date(Date.now() - days * DAY)
    expect((await score(db, service, r, { lead: { attribution, createdAt: at(10) } })).score).toBe(
      4,
    )
    expect((await score(db, service, r, { lead: { attribution, createdAt: at(31) } })).score).toBe(
      3,
    )
    expect((await score(db, service, r, { lead: { attribution, createdAt: at(61) } })).score).toBe(
      2,
    )
    expect((await score(db, service, [rule('07')], { lead: { createdAt: at(61) } })).score).toBe(0)
  })

  it('reachability: a phone number +1', async () => {
    const r = [rule('09')]
    expect(
      (await score(db, service, r, { contact: { email: null, phone: '+52 55 0000 0000' } })).score,
    ).toBe(1)
    expect((await score(db, service, r, { contact: { email: null, phone: '  ' } })).score).toBe(0)
  })

  it('repeat submissions within 7 days: +1 each, up to +2', async () => {
    const r = [rule('0a'), rule('0b')]
    expect((await score(db, service, r, { repeats: 0 })).score).toBe(0)
    expect((await score(db, service, r, { repeats: 1 })).score).toBe(1)
    expect((await score(db, service, r, { repeats: 5 })).score).toBe(2)
  })

  it('a company-domain sales request with a phone is tier A', async () => {
    const result = await score(db, service, SEEDED_SCORING_RULES, {
      lead: { attribution: { intent: 'sales-request' } },
      contact: { email: 'ana@empresa-ficticia.mx', phone: '+52 55 0000 0000' },
    })
    expect(result).toEqual({ score: 7, tier: 'A' })
  })

  it('a free-mail request for access is tier C', async () => {
    const result = await score(db, service, SEEDED_SCORING_RULES, {
      lead: { attribution: { intent: 'request-access' }, source: 'marketing-nav' },
      contact: { email: 'ana@gmail.com', phone: null },
    })
    expect(result).toEqual({ score: 2, tier: 'C' })
  })
})

describe('migration 0024 seeds the same rules', () => {
  const dir = join(__dirname, '../../../db/src/migrations')
  const file = readdirSync(dir).find((name) => name.startsWith('0024_'))
  const sqlText = file ? readFileSync(join(dir, file), 'utf8') : ''

  it.each(SEEDED_SCORING_RULES.map((seeded) => [seeded.name, seeded] as const))(
    '%s',
    (_name, seeded) => {
      const row = sqlText.split('\n').find((line) => line.includes(`'${seeded.id}'`))
      expect(row).toBeDefined()
      expect(row).toContain(`'${seeded.name}'`)
      expect(row).toContain(`'${seeded.category}'`)
      expect(row).toContain(`'${JSON.stringify(seeded.condition)}'::jsonb, ${seeded.points}, true`)
    },
  )
})

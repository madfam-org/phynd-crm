/**
 * The projections copy named columns only: a column a table gains tomorrow
 * (here, `secret_note`) never reaches an output, and every output matches the
 * schema the tool publishes.
 */
import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_SCHEMA,
  CONTACT_SCHEMA,
  DEAL_SCHEMA,
  LEAD_SCHEMA,
  PIPELINE_SCHEMA,
  toActivity,
  toContact,
  toDeal,
  toLead,
  toPipeline,
} from '../records'
import { schemaViolations } from './harness'

const NOW = new Date('2026-11-14T00:00:00.000Z')
const EXTRA = {
  secret_note: 'x',
  secretNote: 'x',
  deletedAt: NOW,
  externalJanuaId: 'sub',
  marketingConsent: true,
  consentedAt: NOW,
  unsubscribed: true,
  unsubscribedAt: NOW,
  coformaCabId: 'cab',
  accessToken: 'tok',
}

describe('record projections', () => {
  it.each([
    [
      'contact',
      CONTACT_SCHEMA,
      toContact({ id: 'c', name: 'N', status: 'active', ...EXTRA }, false),
    ],
    ['activity', ACTIVITY_SCHEMA, toActivity({ id: 'a', title: 'T', dueAt: NOW, ...EXTRA }, false)],
    ['lead', LEAD_SCHEMA, toLead({ id: 'l', score: 3, ...EXTRA })],
    ['deal', DEAL_SCHEMA, toDeal({ id: 'd', name: 'D', value: '1.00', ...EXTRA }, false)],
    [
      'pipeline',
      PIPELINE_SCHEMA,
      toPipeline({ id: 'p', name: 'P', isDefault: true, ...EXTRA }, [
        { id: 's', name: 'S', position: 1, ...EXTRA },
      ]),
    ],
  ] as const)('%s: only declared fields, all of them', (_name, schema, output) => {
    expect(schemaViolations(output, schema)).toEqual([])
    expect(Object.keys(output).sort()).toEqual([...schema.required].sort())
    expect(JSON.stringify(output)).not.toMatch(
      /secret|deleted|janua|consent|unsubscribed|coforma|tok/i,
    )
  })

  it('turns dates into ISO instants and tolerates missing values', () => {
    expect(toActivity({ id: 'a', dueAt: NOW }, false)).toMatchObject({
      due_at: '2026-11-14T00:00:00.000Z',
      completed_at: null,
      title: '',
      description: null,
    })
  })
})

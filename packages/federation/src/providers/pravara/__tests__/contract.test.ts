/**
 * Contract test for PravaraProvider.
 * Guards PravaraRawData shape (fabrication orders + summary) from pravara/index.ts.
 */
import { describe, expect, it } from 'vitest'

import { PravaraProvider } from '../index'
import {
  JsonSchema,
  assertSchemaValid,
  validateAgainstSchema,
} from '../../../__tests__/contract-helpers'

const schema: JsonSchema = {
  type: 'object',
  required: ['orders', 'summary'],
  additionalProperties: false,
  properties: {
    orders: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'order_id',
          'status',
          'product_name',
          'quantity',
          'started_at',
          'estimated_completion',
          'current_step',
          'total_steps',
          'completed_steps',
        ],
        additionalProperties: false,
        properties: {
          order_id: { type: 'string', minLength: 1 },
          cotiza_order_id: { type: ['string', 'null'] },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'paused', 'completed', 'delayed', 'cancelled'],
          },
          product_name: { type: 'string' },
          quantity: { type: 'integer', minimum: 0 },
          started_at: { type: 'string' },
          estimated_completion: { type: 'string' },
          completed_at: { type: ['string', 'null'] },
          current_step: { type: 'string' },
          total_steps: { type: 'integer', minimum: 0 },
          completed_steps: { type: 'integer', minimum: 0 },
          notes: { type: ['string', 'null'] },
        },
      },
    },
    summary: {
      type: 'object',
      required: ['total', 'in_progress', 'completed', 'delayed'],
      additionalProperties: false,
      properties: {
        total: { type: 'integer', minimum: 0 },
        in_progress: { type: 'integer', minimum: 0 },
        completed: { type: 'integer', minimum: 0 },
        delayed: { type: 'integer', minimum: 0 },
      },
    },
  },
}

const fixture = {
  orders: [
    {
      order_id: 'pv-1',
      cotiza_order_id: 'order-1',
      status: 'in_progress',
      product_name: 'Steel bracket v2',
      quantity: 200,
      started_at: '2026-04-10T00:00:00Z',
      estimated_completion: '2026-05-01T00:00:00Z',
      current_step: 'laser_cut',
      total_steps: 6,
      completed_steps: 3,
      notes: 'Priority customer',
    },
  ],
  summary: { total: 5, in_progress: 2, completed: 2, delayed: 1 },
}

describe('PravaraRawData contract', () => {
  it('typical fixture conforms', () => {
    assertSchemaValid(fixture, schema)
  })

  it('rejects invalid status enum', () => {
    const invalid = { ...fixture, orders: [{ ...fixture.orders[0], status: 'spinning' }] }
    const errors = validateAgainstSchema(invalid, schema)
    expect(errors.some((e) => e.path.includes('status'))).toBe(true)
  })

  it('rejects negative completed_steps', () => {
    const invalid = { ...fixture, orders: [{ ...fixture.orders[0], completed_steps: -1 }] }
    const errors = validateAgainstSchema(invalid, schema)
    expect(errors.some((e) => e.path.includes('completed_steps'))).toBe(true)
  })

  it('rejects summary missing in_progress', () => {
    const { summary, ...rest } = fixture
    const { in_progress: _, ...invalidSummary } = summary
    const invalid = { ...rest, summary: invalidSummary }
    const errors = validateAgainstSchema(invalid, schema)
    expect(errors.some((e) => e.path.includes('in_progress'))).toBe(true)
  })
})

describe('PravaraProvider.map()', () => {
  const provider = new PravaraProvider('https://mes.madfam.io')

  it('maps orders + renames snake_case -> camelCase', () => {
    const result = provider.map(fixture)
    expect(result.orders[0]).toMatchObject({
      orderId: 'pv-1',
      cotizaOrderId: 'order-1',
      productName: 'Steel bracket v2',
      quantity: 200,
      currentStep: 'laser_cut',
      totalSteps: 6,
      completedSteps: 3,
    })
  })

  it('maps summary fields to camelCase', () => {
    const result = provider.map(fixture)
    expect(result.summary).toMatchObject({
      total: 5,
      inProgress: 2,
      completed: 2,
      delayed: 1,
    })
  })
})

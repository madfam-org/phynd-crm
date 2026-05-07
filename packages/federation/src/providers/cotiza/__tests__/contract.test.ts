/**
 * Contract test for CotizaProvider.
 * Guards CotizaRawData shape (orders + quotes) from cotiza/index.ts.
 */
import { describe, expect, it } from 'vitest'

import {
  type JsonSchema,
  assertSchemaValid,
  validateAgainstSchema,
} from '../../../__tests__/contract-helpers'
import { CotizaProvider } from '../index'

type CotizaRawData = Parameters<CotizaProvider['map']>[0]

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined()
  return value as T
}

const schema: JsonSchema = {
  type: 'object',
  required: ['orders', 'quotes'],
  additionalProperties: false,
  properties: {
    orders: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status', 'product_name', 'quantity', 'progress_pct', 'created_at'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          status: { type: 'string' },
          product_name: { type: 'string' },
          quantity: { type: 'integer', minimum: 0 },
          estimated_completion: { type: ['string', 'null'] },
          progress_pct: { type: 'number', minimum: 0, maximum: 100 },
          created_at: { type: 'string' },
        },
      },
    },
    quotes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status', 'total', 'currency', 'valid_until', 'created_at'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1 },
          status: { type: 'string' },
          total: { type: 'number', minimum: 0 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          valid_until: { type: 'string' },
          created_at: { type: 'string' },
        },
      },
    },
  },
}

const fixture: CotizaRawData = {
  orders: [
    {
      id: 'order-1',
      status: 'in_production',
      product_name: 'Custom widget',
      quantity: 50,
      estimated_completion: '2026-05-01T00:00:00Z',
      progress_pct: 60,
      created_at: '2026-04-10T00:00:00Z',
    },
  ],
  quotes: [
    {
      id: 'q-1',
      status: 'pending',
      total: 12500.5,
      currency: 'MXN',
      valid_until: '2026-05-10T00:00:00Z',
      created_at: '2026-04-15T00:00:00Z',
    },
  ],
}

const emptyFixture = { orders: [], quotes: [] }

describe('CotizaRawData contract', () => {
  it.each([
    ['typical', fixture],
    ['empty', emptyFixture],
  ])('fixture "%s" conforms', (_, f) => {
    assertSchemaValid(f, schema)
  })

  it('rejects progress_pct over 100', () => {
    const invalid = {
      ...fixture,
      orders: [{ ...fixture.orders[0], progress_pct: 150 }],
    }
    const errors = validateAgainstSchema(invalid, schema)
    expect(errors.some((e) => e.path.includes('progress_pct'))).toBe(true)
  })

  it('rejects currency that is not a 3-char code', () => {
    const invalid = {
      ...fixture,
      quotes: [{ ...fixture.quotes[0], currency: 'MEXICAN' }],
    }
    const errors = validateAgainstSchema(invalid, schema)
    expect(errors.some((e) => e.path.includes('currency'))).toBe(true)
  })
})

describe('CotizaProvider.map()', () => {
  const provider = new CotizaProvider('https://api.cotiza.mx')

  it('maps orders and quotes to camelCase', () => {
    const result = provider.map(fixture)
    const firstOrder = expectDefined(result.orders[0])
    expect(result.orders).toHaveLength(1)
    expect(firstOrder).toMatchObject({
      id: 'order-1',
      productName: 'Custom widget',
      quantity: 50,
      progress: 60,
    })
    expect(result.activeQuotes).toHaveLength(1)
    expect(result.activeQuotes[0]).toMatchObject({
      id: 'q-1',
      totalAmount: 12500.5,
      currency: 'MXN',
    })
  })

  it('converts created_at + estimated_completion to Date', () => {
    const result = provider.map(fixture)
    const firstOrder = expectDefined(result.orders[0])
    expect(result.orders).toHaveLength(1)
    expect(firstOrder.createdAt).toBeInstanceOf(Date)
    expect(firstOrder.estimatedCompletion).toBeInstanceOf(Date)
  })

  it('estimated_completion null produces null', () => {
    const rawOrder = expectDefined(fixture.orders[0])
    const input: CotizaRawData = {
      ...fixture,
      orders: [{ ...rawOrder, estimated_completion: null }],
    }
    const result = provider.map(input)
    const mappedOrder = expectDefined(result.orders[0])
    expect(mappedOrder.estimatedCompletion).toBeNull()
  })
})

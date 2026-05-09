/**
 * PhyndCRM-side contract test for the DhanamProvider federation integration.
 *
 * Validates that:
 * 1. The DhanamRawCustomer interface shape matches the shared JSON Schema contract
 * 2. The DhanamProvider.map() correctly transforms raw Dhanam responses into
 *    PhyndCRM's internal DhanamBilling type
 *
 * If this test breaks, it means either:
 * - The DhanamRawCustomer interface drifted from the agreed contract
 * - The DhanamProvider.map() transformation has a regression
 * - The contract schema was updated without updating this consumer
 *
 * Shared schema: dhanam-customer-contract.schema.json
 * Counterpart:   dhanam/apps/api/src/modules/billing/__tests__/federation-contract.spec.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DhanamProvider } from '../index'

// ---------------------------------------------------------------------------
// Load the shared contract schema
// ---------------------------------------------------------------------------

interface JsonSchemaProperty {
  type: string | string[]
  required?: string[]
  properties?: Record<string, JsonSchemaProperty>
  items?: JsonSchemaProperty
  enum?: string[]
  minimum?: number
  minLength?: number
  maxLength?: number
  maxItems?: number
  additionalProperties?: boolean
  format?: string
  description?: string
}

interface JsonSchema extends JsonSchemaProperty {
  $schema?: string
  $id?: string
  title?: string
}

const schemaPath = resolve(__dirname, 'dhanam-customer-contract.schema.json')
const contractSchema: JsonSchema = JSON.parse(readFileSync(schemaPath, 'utf-8'))

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined()
  return value as T
}

// ---------------------------------------------------------------------------
// Inline JSON Schema validator (avoids adding ajv as a dependency)
// ---------------------------------------------------------------------------

interface ValidationError {
  path: string
  message: string
}

function validateAgainstSchema(
  value: unknown,
  schema: JsonSchemaProperty,
  path = '$',
): ValidationError[] {
  const errors: ValidationError[] = []

  if (value === null) {
    if (Array.isArray(schema.type) && schema.type.includes('null')) {
      return errors
    }
    errors.push({ path, message: 'expected non-null value' })
    return errors
  }

  // Type check
  const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type]
  const actualType = Array.isArray(value) ? 'array' : typeof value
  const typeMatch = expectedTypes.some((t) => {
    if (t === 'integer') return typeof value === 'number' && Number.isInteger(value)
    if (t === 'null') return value === null
    return actualType === t
  })

  if (!typeMatch) {
    errors.push({
      path,
      message: `expected type ${expectedTypes.join('|')}, got ${actualType}`,
    })
    return errors
  }

  // Enum check
  if (schema.enum && !schema.enum.includes(value as string)) {
    errors.push({
      path,
      message: `value "${value}" not in enum [${schema.enum.join(', ')}]`,
    })
  }

  // Number constraints
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push({ path, message: `value ${value} below minimum ${schema.minimum}` })
  }

  // String constraints
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({
        path,
        message: `string length ${value.length} below minLength ${schema.minLength}`,
      })
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({
        path,
        message: `string length ${value.length} above maxLength ${schema.maxLength}`,
      })
    }
  }

  // Array validation
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({
        path,
        message: `array length ${value.length} exceeds maxItems ${schema.maxItems}`,
      })
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateAgainstSchema(value[i], schema.items, `${path}[${i}]`))
      }
    }
  }

  // Object validation
  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    const obj = value as Record<string, unknown>

    // Required properties
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({ path: `${path}.${key}`, message: 'required property missing' })
        }
      }
    }

    // Additional properties check
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties))
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push({
            path: `${path}.${key}`,
            message: 'unexpected additional property',
          })
        }
      }
    }

    // Validate each property
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          errors.push(...validateAgainstSchema(obj[key], propSchema, `${path}.${key}`))
        }
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Test fixtures: representative Dhanam API responses
// ---------------------------------------------------------------------------

const fixtures = {
  activeSubscriber: {
    id: 'user-fed-001',
    subscription: { plan: 'pro', status: 'active' },
    balance: { amount: 0, currency: 'MXN' },
    invoices: [
      {
        id: 'evt-001',
        amount: 199,
        currency: 'MXN',
        status: 'paid',
        created_at: '2026-03-01T00:00:00.000Z',
        paid_at: '2026-03-01T00:05:00.000Z',
      },
    ],
    payment_methods: [
      {
        id: 'cus_mx_001',
        type: 'stripe',
        last_four: '****',
        is_default: true,
      },
    ],
  },

  communityUser: {
    id: 'user-fed-002',
    subscription: { plan: 'community', status: 'free' },
    balance: { amount: 0, currency: 'USD' },
    invoices: [],
    payment_methods: [],
  },

  trialingUser: {
    id: 'user-fed-003',
    subscription: { plan: 'pro', status: 'trialing' },
    balance: { amount: 0, currency: 'MXN' },
    invoices: [],
    payment_methods: [
      {
        id: 'cus_stripe_003',
        type: 'stripe',
        last_four: '****',
        is_default: true,
      },
    ],
  },

  expiredWithBalance: {
    id: 'user-fed-004',
    subscription: { plan: 'pro', status: 'expired' },
    balance: { amount: 398, currency: 'MXN' },
    invoices: [
      {
        id: 'evt-fail-1',
        amount: 199,
        currency: 'MXN',
        status: 'failed',
        created_at: '2026-03-15T10:00:00.000Z',
        paid_at: null,
      },
      {
        id: 'evt-fail-2',
        amount: 199,
        currency: 'MXN',
        status: 'open',
        created_at: '2026-03-16T10:00:00.000Z',
        paid_at: null,
      },
    ],
    payment_methods: [
      {
        id: 'ctm_paddle_004',
        type: 'paddle',
        last_four: '****',
        is_default: true,
      },
      {
        id: 'cus_stripe_004',
        type: 'stripe',
        last_four: '****',
        is_default: false,
      },
    ],
  },

  multiProviderUser: {
    id: 'user-fed-005',
    subscription: { plan: 'enterprise', status: 'active' },
    balance: { amount: 0, currency: 'USD' },
    invoices: [
      {
        id: 'evt-refund-1',
        amount: 499,
        currency: 'USD',
        status: 'refunded',
        created_at: '2026-02-01T00:00:00.000Z',
        paid_at: null,
      },
      {
        id: 'evt-paid-1',
        amount: 499,
        currency: 'USD',
        status: 'paid',
        created_at: '2026-01-01T00:00:00.000Z',
        paid_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    payment_methods: [
      {
        id: 'cus_stripe_005',
        type: 'stripe',
        last_four: '****',
        is_default: false,
      },
      {
        id: 'ctm_paddle_005',
        type: 'paddle',
        last_four: '****',
        is_default: true,
      },
      {
        id: 'jan_005',
        type: 'janua',
        last_four: '****',
        is_default: false,
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// Contract validation tests
// ---------------------------------------------------------------------------

describe('DhanamRawCustomer contract schema validation', () => {
  describe('fixture data matches shared contract schema', () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      it(`fixture "${name}" conforms to contract schema`, () => {
        const errors = validateAgainstSchema(fixture, contractSchema)
        if (errors.length > 0) {
          const formatted = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')
          throw new Error(`Schema validation failed:\n${formatted}`)
        }
      })
    }
  })

  describe('schema rejects invalid shapes', () => {
    it('rejects response missing required "id" field', () => {
      const invalid = { ...fixtures.activeSubscriber, id: undefined }
      delete invalid.id
      const errors = validateAgainstSchema(invalid, contractSchema)
      expect(errors.some((e) => e.path === '$.id')).toBe(true)
    })

    it('rejects response missing "subscription" field', () => {
      const { subscription: _, ...invalid } = fixtures.activeSubscriber
      const errors = validateAgainstSchema(invalid, contractSchema)
      expect(errors.some((e) => e.path === '$.subscription')).toBe(true)
    })

    it('rejects response missing "balance" field', () => {
      const { balance: _, ...invalid } = fixtures.activeSubscriber
      const errors = validateAgainstSchema(invalid, contractSchema)
      expect(errors.some((e) => e.path === '$.balance')).toBe(true)
    })

    it('rejects response missing "invoices" field', () => {
      const { invoices: _, ...invalid } = fixtures.activeSubscriber
      const errors = validateAgainstSchema(invalid, contractSchema)
      expect(errors.some((e) => e.path === '$.invoices')).toBe(true)
    })

    it('rejects response missing "payment_methods" field', () => {
      const { payment_methods: _, ...invalid } = fixtures.activeSubscriber
      const errors = validateAgainstSchema(invalid, contractSchema)
      expect(errors.some((e) => e.path === '$.payment_methods')).toBe(true)
    })

    it('rejects invalid subscription status', () => {
      const invalid = {
        ...fixtures.activeSubscriber,
        subscription: { plan: 'pro', status: 'cancelled' },
      }
      const errors = validateAgainstSchema(invalid, contractSchema)
      expect(errors.some((e) => e.path === '$.subscription.status')).toBe(true)
    })

    it('rejects invalid invoice status', () => {
      const invalid = {
        ...fixtures.activeSubscriber,
        invoices: [
          {
            ...fixtures.activeSubscriber.invoices[0],
            status: 'void',
          },
        ],
      }
      const errors = validateAgainstSchema(invalid, contractSchema)
      expect(errors.some((e) => e.path.includes('status'))).toBe(true)
    })

    it('rejects negative balance amount', () => {
      const invalid = {
        ...fixtures.activeSubscriber,
        balance: { amount: -100, currency: 'MXN' },
      }
      const errors = validateAgainstSchema(invalid, contractSchema)
      expect(errors.some((e) => e.path === '$.balance.amount')).toBe(true)
    })

    it('rejects additional properties at root level', () => {
      const invalid = {
        ...fixtures.activeSubscriber,
        extraField: 'unexpected',
      }
      const errors = validateAgainstSchema(invalid, contractSchema)
      expect(errors.some((e) => e.message.includes('additional property'))).toBe(true)
    })
  })

  describe('schema structural completeness', () => {
    it('contract schema defines all DhanamRawCustomer top-level fields', () => {
      const requiredFields = ['id', 'subscription', 'balance', 'invoices', 'payment_methods']
      expect(contractSchema.required).toEqual(expect.arrayContaining(requiredFields))
      expect(contractSchema.required).toHaveLength(requiredFields.length)
    })

    it('contract schema defines all subscription properties', () => {
      const properties = expectDefined(contractSchema.properties)
      const subSchema = properties.subscription
      expect(subSchema?.required).toEqual(expect.arrayContaining(['plan', 'status']))
    })

    it('contract schema defines all balance properties', () => {
      const properties = expectDefined(contractSchema.properties)
      const balSchema = properties.balance
      expect(balSchema?.required).toEqual(expect.arrayContaining(['amount', 'currency']))
    })

    it('contract schema defines all invoice properties', () => {
      const properties = expectDefined(contractSchema.properties)
      const invItemSchema = properties.invoices?.items
      const expectedFields = ['id', 'amount', 'currency', 'status', 'created_at', 'paid_at']
      expect(invItemSchema?.required).toEqual(expect.arrayContaining(expectedFields))
    })

    it('contract schema defines all payment_method properties', () => {
      const properties = expectDefined(contractSchema.properties)
      const pmItemSchema = properties.payment_methods?.items
      const expectedFields = ['id', 'type', 'last_four', 'is_default']
      expect(pmItemSchema?.required).toEqual(expect.arrayContaining(expectedFields))
    })

    it('contract schema disallows additional properties at every level', () => {
      expect(contractSchema.additionalProperties).toBe(false)
      expect(contractSchema.properties?.subscription?.additionalProperties).toBe(false)
      expect(contractSchema.properties?.balance?.additionalProperties).toBe(false)
      expect(contractSchema.properties?.invoices?.items?.additionalProperties).toBe(false)
      expect(contractSchema.properties?.payment_methods?.items?.additionalProperties).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// DhanamProvider.map() transformation tests
// ---------------------------------------------------------------------------

describe('DhanamProvider.map() transformation', () => {
  const provider = new DhanamProvider('https://api.dhan.am/v1')

  it('maps active subscriber raw data to DhanamBilling format', () => {
    const result = provider.map(fixtures.activeSubscriber)

    expect(result).toEqual({
      customerId: 'user-fed-001',
      plan: 'pro',
      status: 'active',
      currentBalance: 0,
      currency: 'MXN',
      invoices: [
        {
          id: 'evt-001',
          amount: 199,
          currency: 'MXN',
          status: 'paid',
          issuedAt: new Date('2026-03-01T00:00:00.000Z'),
          paidAt: new Date('2026-03-01T00:05:00.000Z'),
        },
      ],
      paymentMethods: [
        {
          id: 'cus_mx_001',
          type: 'stripe',
          last4: '****',
          isDefault: true,
        },
      ],
    })
  })

  it('maps community user with no invoices or payment methods', () => {
    const result = provider.map(fixtures.communityUser)

    expect(result.customerId).toBe('user-fed-002')
    expect(result.plan).toBe('community')
    expect(result.status).toBe('free')
    expect(result.currentBalance).toBe(0)
    expect(result.invoices).toEqual([])
    expect(result.paymentMethods).toEqual([])
  })

  it('maps trialing user subscription correctly', () => {
    const result = provider.map(fixtures.trialingUser)

    expect(result.plan).toBe('pro')
    expect(result.status).toBe('trialing')
  })

  it('maps expired user with outstanding balance', () => {
    const result = provider.map(fixtures.expiredWithBalance)

    expect(result.status).toBe('expired')
    expect(result.currentBalance).toBe(398)
    expect(result.invoices).toHaveLength(2)
  })

  it('maps invoice paid_at as null when raw paid_at is null', () => {
    const result = provider.map(fixtures.expiredWithBalance)

    expect(expectDefined(result.invoices[0]).paidAt).toBeNull()
    expect(expectDefined(result.invoices[1]).paidAt).toBeNull()
  })

  it('maps invoice paid_at as Date when raw paid_at is a string', () => {
    const result = provider.map(fixtures.activeSubscriber)
    const invoice = expectDefined(result.invoices[0])

    expect(invoice.paidAt).toBeInstanceOf(Date)
    expect(invoice.paidAt?.toISOString()).toBe('2026-03-01T00:05:00.000Z')
  })

  it('renames last_four to last4 in payment methods', () => {
    const result = provider.map(fixtures.activeSubscriber)

    const paymentMethod = expectDefined(result.paymentMethods[0])
    expect(paymentMethod).toHaveProperty('last4')
    expect(paymentMethod).not.toHaveProperty('last_four')
  })

  it('renames is_default to isDefault in payment methods', () => {
    const result = provider.map(fixtures.activeSubscriber)

    const paymentMethod = expectDefined(result.paymentMethods[0])
    expect(paymentMethod).toHaveProperty('isDefault')
    expect(paymentMethod).not.toHaveProperty('is_default')
  })

  it('maps multiple payment methods preserving order', () => {
    const result = provider.map(fixtures.multiProviderUser)

    expect(result.paymentMethods).toHaveLength(3)
    expect(expectDefined(result.paymentMethods[0]).type).toBe('stripe')
    expect(expectDefined(result.paymentMethods[1]).type).toBe('paddle')
    expect(expectDefined(result.paymentMethods[2]).type).toBe('janua')
  })

  it('converts created_at string to issuedAt Date', () => {
    const result = provider.map(fixtures.activeSubscriber)
    const invoice = expectDefined(result.invoices[0])

    expect(invoice.issuedAt).toBeInstanceOf(Date)
    expect(invoice.issuedAt.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('maps balance amount and currency from raw fields', () => {
    const result = provider.map(fixtures.activeSubscriber)

    expect(result.currentBalance).toBe(fixtures.activeSubscriber.balance.amount)
    expect(result.currency).toBe(fixtures.activeSubscriber.balance.currency)
  })
})

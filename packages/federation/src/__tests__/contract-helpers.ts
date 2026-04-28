/**
 * Shared JSON-Schema validator for federation contract tests.
 *
 * Extracted from the Dhanam contract test (the pattern was duplicated
 * in each provider's __tests__/contract.test.ts). Now every
 * provider contract test can import this same validator.
 *
 * No runtime dep (zero `ajv`): we traverse the schema manually so
 * these tests stay lightweight and never need a separate build step.
 */

export interface JsonSchemaProperty {
  type?: string | string[]
  required?: string[]
  properties?: Record<string, JsonSchemaProperty>
  items?: JsonSchemaProperty
  enum?: string[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  additionalProperties?: boolean
  format?: string
  description?: string
  anyOf?: JsonSchemaProperty[]
  oneOf?: JsonSchemaProperty[]
}

export interface JsonSchema extends JsonSchemaProperty {
  $schema?: string
  $id?: string
  title?: string
}

export interface ValidationError {
  path: string
  message: string
}

export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchemaProperty,
  path = '$',
): ValidationError[] {
  const errors: ValidationError[] = []

  if (value === null) {
    if (Array.isArray(schema.type) && schema.type.includes('null')) {
      return errors
    }
    if (schema.type === 'null') return errors
    errors.push({ path, message: 'expected non-null value' })
    return errors
  }

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type]
    const actual = Array.isArray(value) ? 'array' : typeof value
    const match = expected.some((t) => {
      if (t === 'integer') return typeof value === 'number' && Number.isInteger(value)
      if (t === 'null') return value === null
      return actual === t
    })
    if (!match) {
      errors.push({
        path,
        message: `expected type ${expected.join('|')}, got ${actual}`,
      })
      return errors
    }
  }

  if (schema.enum && !schema.enum.includes(value as string)) {
    errors.push({
      path,
      message: `value "${value}" not in enum [${schema.enum.join(', ')}]`,
    })
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path, message: `value ${value} below minimum ${schema.minimum}` })
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path, message: `value ${value} above maximum ${schema.maximum}` })
    }
  }

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

  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({
        path,
        message: `array length ${value.length} exceeds maxItems ${schema.maxItems}`,
      })
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({
        path,
        message: `array length ${value.length} below minItems ${schema.minItems}`,
      })
    }
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(
          ...validateAgainstSchema(item, schema.items as JsonSchemaProperty, `${path}[${i}]`),
        )
      })
    }
  }

  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    const obj = value as Record<string, unknown>
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({ path: `${path}.${key}`, message: 'required property missing' })
        }
      }
    }
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

export function assertSchemaValid(
  value: unknown,
  schema: JsonSchemaProperty,
  label = 'value',
): void {
  const errors = validateAgainstSchema(value, schema)
  if (errors.length > 0) {
    const formatted = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')
    throw new Error(`${label} failed schema validation:\n${formatted}`)
  }
}

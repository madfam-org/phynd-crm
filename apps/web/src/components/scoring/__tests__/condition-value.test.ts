import { describe, expect, it } from 'vitest'
import { formatConditionValue, parseConditionValue } from '../condition-value'

describe('scoring condition values', () => {
  it('keeps an unchanged value exactly (editing points keeps the condition)', () => {
    for (const original of [false, 30, ['dc3', 'compliance'], 'sales-request']) {
      expect(parseConditionValue(formatConditionValue(original), 'eq', original)).toEqual(original)
    }
  })

  it('reads numbers, booleans and lists as typed values', () => {
    expect(parseConditionValue('45', 'gt')).toBe(45)
    expect(parseConditionValue('true', 'eq')).toBe(true)
    expect(parseConditionValue('["a","b"]', 'in')).toEqual(['a', 'b'])
    expect(parseConditionValue('sales-request', 'eq')).toBe('sales-request')
    expect(parseConditionValue('  ', 'eq')).toBeUndefined()
  })

  it('turns a comma list into a list for "in"', () => {
    expect(parseConditionValue('demo-home, producto-comply', 'in')).toEqual([
      'demo-home',
      'producto-comply',
    ])
  })
})

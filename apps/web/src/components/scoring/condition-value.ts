// A scoring condition's value as typed in the rule dialogs, and back. Values
// are typed: a number for `gt`/`lt`, `true`/`false`, a list for `in`; a plain
// string otherwise. Editing a rule's name or points must leave its value
// exactly as it was.

/** How a stored value is shown in the text field. */
export function formatConditionValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * The value to store for the text typed. Unchanged text keeps the original
 * value; JSON numbers, booleans and lists are read as such; for `in`, a comma
 * list becomes a list; anything else stays the string typed; empty = none.
 */
export function parseConditionValue(text: string, operator: string, original?: unknown): unknown {
  if (original !== undefined && text === formatConditionValue(original)) return original
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  let parsed: unknown = trimmed
  if (/^(-?\d+(\.\d+)?|true|false|\[.*\])$/s.test(trimmed)) {
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      parsed = trimmed
    }
  }
  if (operator === 'in' && !Array.isArray(parsed)) {
    return String(parsed)
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
  }
  return parsed
}

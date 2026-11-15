/**
 * A `LIKE`/`ILIKE` pattern that matches `text` as a literal substring: the
 * wildcards `%` and `_` and the escape character `\` are escaped, so a caller's
 * search text can never widen the match.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

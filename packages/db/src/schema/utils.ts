import crypto from 'node:crypto'

export function createId(): string {
  return crypto.randomUUID()
}

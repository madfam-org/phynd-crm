import pino from 'pino'

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info'
const NODE_ENV = process.env.NODE_ENV ?? 'development'

/**
 * Creates a structured JSON logger with base context fields.
 *
 * @param name - Logical service name (e.g. "worker:lead-scoring", "web:webhook")
 * @returns A pino logger instance with service/environment context
 */
export function createLogger(name: string): pino.Logger {
  return pino({
    name,
    level: LOG_LEVEL,
    base: {
      service: name,
      env: NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label }
      },
    },
  })
}

export type { Logger } from 'pino'

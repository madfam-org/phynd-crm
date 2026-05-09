import { createLogger } from './index'

const logger = createLogger('web:middleware')

/**
 * Wraps a Next.js route handler with a correlation ID.
 * Generates a UUID per request, logs it, and sets it on the response header.
 */
export function withCorrelationId(
  handler: (request: Request, correlationId: string) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()

    logger.info({ correlationId, method: request.method, url: request.url }, 'Incoming request')

    const response = await handler(request, correlationId)
    response.headers.set('x-correlation-id', correlationId)

    return response
  }
}

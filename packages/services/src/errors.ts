export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'NOT_FOUND', 404)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details)
    this.name = 'ValidationError'
  }
}

export class FederationError extends ServiceError {
  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super(`Federation error (${provider}): ${message}`, 'FEDERATION_ERROR', 502, details)
    this.name = 'FederationError'
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details)
    this.name = 'ConflictError'
  }
}

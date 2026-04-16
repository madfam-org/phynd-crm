import { NextResponse } from 'next/server'

/**
 * Validates the federation API token from the Authorization header.
 * Used by REST routes that external products call for service-to-service auth.
 */
export function validateFederationAuth(
  req: Request,
): { valid: true } | { valid: false; response: NextResponse } {
  const token = process.env.FEDERATION_API_TOKEN ?? ''
  if (!token) {
    return {
      valid: false,
      response: NextResponse.json({ error: 'Not configured' }, { status: 503 }),
    }
  }

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${token}`) {
    return {
      valid: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { valid: true }
}

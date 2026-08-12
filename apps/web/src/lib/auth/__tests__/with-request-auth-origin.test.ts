import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withRequestAuthOrigin } from '../with-request-auth-origin'

function crmRequest(): NextRequest {
  return new NextRequest('https://crm.madfam.io/api/auth/session', {
    headers: {
      host: 'crm.madfam.io',
      'x-forwarded-host': 'crm.madfam.io',
      'x-forwarded-proto': 'https',
    },
  })
}

const ORIGINAL = {
  AUTH_URL: process.env.AUTH_URL,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
}

function restore(key: 'AUTH_URL' | 'NEXTAUTH_URL') {
  if (ORIGINAL[key] === undefined) delete process.env[key]
  else process.env[key] = ORIGINAL[key]
}

describe('withRequestAuthOrigin env hygiene', () => {
  beforeEach(() => {
    delete process.env.AUTH_URL
    delete process.env.NEXTAUTH_URL
  })

  afterEach(() => {
    restore('AUTH_URL')
    restore('NEXTAUTH_URL')
  })

  it('binds AUTH_URL to the request origin for the duration of the handler', async () => {
    let seen: string | undefined
    await withRequestAuthOrigin(crmRequest(), () => {
      seen = process.env.AUTH_URL
      return new Response('ok')
    })
    expect(seen).toBe('https://crm.madfam.io')
  })

  it('leaves the env keys ABSENT afterwards — never the string "undefined"', async () => {
    // Regression (2026-08-12): the restore path assigned `undefined`, which
    // process.env coerces to the string "undefined". Auth.js treats that as a
    // configured URL, new URL("undefined") throws, and every subsequent
    // auth() in the process fails — one sign-in poisoned the whole pod.
    await withRequestAuthOrigin(crmRequest(), () => new Response('ok'))
    expect('AUTH_URL' in process.env).toBe(false)
    expect('NEXTAUTH_URL' in process.env).toBe(false)
    expect(process.env.AUTH_URL).not.toBe('undefined')
    expect(process.env.NEXTAUTH_URL).not.toBe('undefined')
  })

  it('restores a pre-existing AUTH_URL to its original value', async () => {
    process.env.AUTH_URL = 'https://original.example'
    await withRequestAuthOrigin(crmRequest(), () => new Response('ok'))
    expect(process.env.AUTH_URL).toBe('https://original.example')
  })

  it('restores cleanly even when the handler throws', async () => {
    await expect(
      withRequestAuthOrigin(crmRequest(), () => {
        throw new Error('handler exploded')
      }),
    ).rejects.toThrow('handler exploded')
    expect('AUTH_URL' in process.env).toBe(false)
    expect('NEXTAUTH_URL' in process.env).toBe(false)
  })
})

#!/usr/bin/env node
/**
 * Minimal Janua API stub for Playwright E2E.
 * PhyndCRM server-side fetch calls JANUA_API_URL for portal magic links.
 */
import http from 'node:http'

const PORT = Number(process.env.E2E_JANUA_PORT ?? 4001)
const HOST = process.env.E2E_JANUA_HOST ?? '127.0.0.1'

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/'

  if (req.method === 'GET' && url === '/health') {
    sendJson(res, 200, { ok: true, service: 'e2e-janua-stub' })
    return
  }

  if (req.method === 'POST' && url === '/api/v1/auth/magic-link') {
    await readBody(req)
    sendJson(res, 200, { sent: true })
    return
  }

  if (req.method === 'POST' && url === '/api/v1/auth/magic-link/verify') {
    const raw = await readBody(req)
    let email = 'client@example.com'
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed.email === 'string') email = parsed.email
    } catch {
      // keep default email for stubbed verify flows
    }

    sendJson(res, 200, {
      user: { id: 'janua-e2e-user', email, email_verified: true },
      tokens: {
        access_token: 'e2e-access-token',
        refresh_token: 'e2e-refresh-token',
        expires_in: 900,
        token_type: 'bearer',
      },
    })
    return
  }

  sendJson(res, 404, { error: 'not_found', path: url })
})

server.listen(PORT, HOST, () => {
  process.stdout.write(`e2e-janua-stub listening on http://${HOST}:${PORT}\n`)
})

function shutdown(signal) {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
  process.stderr.write(`e2e-janua-stub shutting down (${signal})\n`)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

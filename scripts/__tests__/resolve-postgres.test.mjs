/**
 * `postgres` resolution for the scripts that run inside the worker image.
 *
 * The worker image is `pnpm deploy --filter=@phynd/worker`, where
 * node_modules/@phynd/db is a symlink into node_modules/.pnpm and `postgres`
 * sits next to the symlink TARGET. Resolving from the link path fails
 * («cannot resolve the `postgres` package»); resolving from its real path works.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolvePostgresPath as resolveForAudit } from '../audit-session-user-ids.mjs'
import { resolvePostgresPath as resolveForLink } from '../link-janua-users.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scripts = {
  'audit-session-user-ids.mjs': resolveForAudit,
  'link-janua-users.mjs': resolveForLink,
}

/** A pnpm-deploy-shaped /app with a fake `postgres` that announces itself. */
function fakeDeployLayout() {
  const app = mkdtempSync(path.join(tmpdir(), 'phynd-worker-deploy-'))
  const store = path.join(app, 'node_modules/.pnpm/@phynd+db@file+packages+db/node_modules')
  mkdirSync(path.join(store, '@phynd/db'), { recursive: true })
  writeFileSync(path.join(store, '@phynd/db/package.json'), '{"name":"@phynd/db"}')
  mkdirSync(path.join(store, 'postgres'), { recursive: true })
  writeFileSync(
    path.join(store, 'postgres/package.json'),
    '{"name":"postgres","main":"index.cjs"}',
  )
  writeFileSync(
    path.join(store, 'postgres/index.cjs'),
    'module.exports = () => { throw new Error("fake-postgres-loaded") }',
  )
  mkdirSync(path.join(app, 'node_modules/@phynd'), { recursive: true })
  symlinkSync(
    '../.pnpm/@phynd+db@file+packages+db/node_modules/@phynd/db',
    path.join(app, 'node_modules/@phynd/db'),
  )
  return app
}

const app = fakeDeployLayout()
after(() => rmSync(app, { recursive: true, force: true }))

test('the old link-path lookup fails in the deploy layout (the production error)', () => {
  assert.throws(
    () => createRequire(path.join(app, 'node_modules/@phynd/db/package.json'))('postgres'),
    /Cannot find module 'postgres'/,
  )
})

for (const [name, resolve] of Object.entries(scripts)) {
  test(`${name}: resolves postgres from the worker deploy layout`, () => {
    const resolved = resolve({ cwd: app, scriptUrl: 'file:///app/[eval1]' })
    assert.match(resolved, /\.pnpm\/@phynd\+db@file\+packages\+db\/node_modules\/postgres\//)
  })

  test(`${name}: resolves postgres from the repo root`, () => {
    const resolved = resolve({ cwd: repoRoot })
    assert.match(resolved, /postgres/)
  })

  test(`${name}: fails with a clear message where nothing is installed`, () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'phynd-empty-'))
    try {
      assert.throws(
        () => resolve({ cwd: empty, scriptUrl: 'file:///nowhere/[eval1]' }),
        /cannot resolve the `postgres` package/,
      )
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  test(`${name}: piped on stdin from the deploy dir, it loads postgres`, () => {
    const res = spawnSync(process.execPath, ['--input-type=module', '-'], {
      cwd: app,
      input: readFileSync(path.join(repoRoot, 'scripts', name), 'utf8'),
      env: { PATH: process.env.PATH, DATABASE_URL: 'postgresql://x@127.0.0.1:1/none' },
      encoding: 'utf8',
    })
    assert.equal(res.status, 1)
    assert.match(res.stderr, /fake-postgres-loaded/)
  })
}

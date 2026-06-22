import { defineConfig, devices } from '@playwright/test'

// Test worker + webServer both need AUTH_BYPASS (CI sets it globally; local dev defaults here).
process.env.AUTH_BYPASS ??= 'true'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node ../../scripts/e2e-janua-stub.mjs',
      url: 'http://127.0.0.1:4001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        AUTH_BYPASS: process.env.AUTH_BYPASS ?? 'true',
        AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-test-secret-minimum-16',
        AUTH_JANUA_ISSUER: process.env.AUTH_JANUA_ISSUER ?? 'https://janua.example.com',
        AUTH_JANUA_CLIENT_ID: process.env.AUTH_JANUA_CLIENT_ID ?? 'e2e-client-id',
        AUTH_JANUA_CLIENT_SECRET: process.env.AUTH_JANUA_CLIENT_SECRET ?? 'e2e-client-secret',
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
        PORTAL_BASE_URL: process.env.PORTAL_BASE_URL ?? 'http://localhost:3000',
        JANUA_API_URL: process.env.JANUA_API_URL ?? 'http://127.0.0.1:4001',
      },
    },
  ],
})

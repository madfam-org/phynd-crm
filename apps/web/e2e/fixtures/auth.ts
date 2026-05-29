import { test as base, expect } from '@playwright/test'

/**
 * Dashboard E2E tests assume AUTH_BYPASS in non-production (see middleware.ts).
 * Playwright webServer env defaults AUTH_BYPASS=true when unset.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page)
  },
})

export { expect }

export function requireAuthBypass() {
  test.skip(process.env.AUTH_BYPASS !== 'true', 'Requires AUTH_BYPASS=true for dashboard access')
}

export async function gotoDashboard(page: import('@playwright/test').Page, path = '/overview') {
  await page.goto(path)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
}

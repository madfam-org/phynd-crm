import { expect, test } from '@playwright/test'

test.describe('Smoke tests', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Phynd' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in with Janua' })).toBeVisible()
  })

  test('marketing landing page loads for unauthenticated users', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toContainText('The CRM Built for')
  })

  test('unauthenticated users are redirected from dashboard to login', async ({ page }) => {
    test.skip(process.env.AUTH_BYPASS === 'true', 'AUTH_BYPASS skips redirects')
    await page.goto('/overview')
    await expect(page).toHaveURL(/\/login/)
  })
})

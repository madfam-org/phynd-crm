import { expect, test } from '@playwright/test'

test.describe('Navigation', () => {
  test.describe('marketing page', () => {
    test('landing page renders with key sections', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator('h1')).toContainText('The CRM Built for')
    })
  })

  test.describe('unauthenticated redirects', () => {
    test('redirects /overview to /login', async ({ page }) => {
      test.skip(process.env.AUTH_BYPASS === 'true', 'AUTH_BYPASS skips redirects')
      await page.goto('/overview')
      await expect(page).toHaveURL(/\/login/)
    })

    test('redirects /contacts to /login', async ({ page }) => {
      test.skip(process.env.AUTH_BYPASS === 'true', 'AUTH_BYPASS skips redirects')
      await page.goto('/contacts')
      await expect(page).toHaveURL(/\/login/)
    })

    test('redirects /analytics to /login', async ({ page }) => {
      test.skip(process.env.AUTH_BYPASS === 'true', 'AUTH_BYPASS skips redirects')
      await page.goto('/analytics')
      await expect(page).toHaveURL(/\/login/)
    })
  })
})

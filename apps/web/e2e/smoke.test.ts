import { expect, test } from '@playwright/test'

test.describe('Smoke tests', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('h1')).toContainText('Phyne CRM')
    await expect(page.locator('button')).toContainText('Sign in with Janua')
  })

  test('marketing landing page loads for unauthenticated users', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toContainText('The CRM Built for')
  })

  test('unauthenticated users are redirected from dashboard to login', async ({ page }) => {
    await page.goto('/overview')
    await expect(page).toHaveURL(/\/login/)
  })
})

import { test, expect } from '@playwright/test'

test.describe('Smoke tests', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('h1')).toContainText('Phyne CRM')
    await expect(page.locator('button')).toContainText('Sign in with Janua')
  })

  test('unauthenticated users are redirected to login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })
})

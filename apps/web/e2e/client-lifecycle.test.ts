import { expect, test } from '@playwright/test'
import { gotoDashboard, requireAuthBypass } from './fixtures/auth'

test.describe('Client lifecycle golden path', () => {
  test.beforeEach(() => {
    requireAuthBypass()
  })

  test('onboards a client project and publishes quote to portal', async ({ page }) => {
    const runId = Date.now()
    const clientEmail = `e2e-client-${runId}@example.com`

    await page.route('**/api/v1/auth/magic-link', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sent: true }),
      })
    })

    await gotoDashboard(page, '/engagements')

    await page.getByTestId('onboard-client-project-trigger').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.locator('#onboard-client-name').fill(`E2E Client ${runId}`)
    await page.locator('#onboard-client-email').fill(clientEmail)
    await page.locator('#onboard-project-name').fill(`E2E Project ${runId}`)
    await page.locator('#onboard-amount').fill('12500')
    await page.locator('#onboard-currency').fill('USD')

    await page.getByRole('button', { name: 'Onboard' }).click()

    await expect(page).toHaveURL(/\/engagements\/[a-zA-Z0-9_-]+/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`E2E Project ${runId}`)

    await page.getByTestId('publish-quote-portal-btn').click()
    await expect(page.getByText('Client notified')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('tab', { name: 'Timeline' }).click()
    await expect(page.getByText(/quote sent/i)).toBeVisible({ timeout: 10_000 })
  })
})

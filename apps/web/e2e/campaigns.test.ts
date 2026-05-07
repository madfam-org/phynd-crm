import { expect, test } from '@playwright/test'

test.describe('Campaigns', () => {
  test('unauthenticated users are redirected from campaigns to login', async ({ page }) => {
    test.skip(process.env.AUTH_BYPASS === 'true', 'AUTH_BYPASS skips redirect')
    await page.goto('/campaigns')
    await expect(page).toHaveURL(/\/login/)
  })

  test('campaigns page renders data table', async ({ page }) => {
    // Requires: authenticated session
    await page.goto('/campaigns')
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create Campaign' })).toBeVisible()
  })

  test('create campaign dialog opens and has required fields', async ({ page }) => {
    // Requires: authenticated session
    await page.goto('/campaigns')
    await page.getByRole('button', { name: 'Create Campaign' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create Campaign' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Name *')).toBeVisible()
    await expect(dialog.getByText('Channel', { exact: true })).toBeVisible()
    await expect(dialog.getByText('UTM Parameters')).toBeVisible()
  })

  test('campaigns table shows channel and status badges', async ({ page }) => {
    // Requires: authenticated session + seeded campaigns
    await page.goto('/campaigns')
    // Table headers should include Channel and Status columns
    await expect(page.getByRole('columnheader', { name: 'Channel' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
  })

  test('campaign row actions include Edit and Delete', async ({ page }) => {
    // Requires: authenticated session + seeded campaigns
    await page.goto('/campaigns')
    // Click the actions menu on the first row
    const actionsButton = page.getByRole('button', { name: '...' }).first()
    await actionsButton.click()
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
  })
})

import { expect, test } from '@playwright/test'

test.describe('Global Search', () => {
  test('search input is visible in header', async ({ page }) => {
    await page.goto('/overview')
    // Unauthenticated users redirect to /login, so check there if redirect occurs
    const url = page.url()
    if (url.includes('/login')) {
      // The search bar is only rendered in the authenticated dashboard layout
      test.skip()
      return
    }
    const searchInput = page.getByPlaceholder('Search contacts, leads, opportunities...')
    await expect(searchInput).toBeVisible()
  })

  test('search input has accessible label', async ({ page }) => {
    await page.goto('/overview')
    const url = page.url()
    if (url.includes('/login')) {
      test.skip()
      return
    }
    const searchInput = page.getByLabel('Global search')
    await expect(searchInput).toBeVisible()
  })

  test('keyboard shortcut hint is displayed', async ({ page }) => {
    await page.goto('/overview')
    const url = page.url()
    if (url.includes('/login')) {
      test.skip()
      return
    }
    // The Cmd+K keyboard hint badge should be visible
    const kbdHint = page.locator('kbd')
    await expect(kbdHint).toBeVisible()
  })

  test('Cmd+K focuses search input', async ({ page }) => {
    // Requires authenticated session to access dashboard layout where GlobalSearch is rendered
    await page.goto('/overview')
    await page.keyboard.press('Meta+k')
    const searchInput = page.getByPlaceholder('Search contacts, leads, opportunities...')
    await expect(searchInput).toBeFocused()
  })

  test('Ctrl+K focuses search input on non-Mac platforms', async ({ page }) => {
    // Requires authenticated session
    await page.goto('/overview')
    await page.keyboard.press('Control+k')
    const searchInput = page.getByPlaceholder('Search contacts, leads, opportunities...')
    await expect(searchInput).toBeFocused()
  })

  test('typing in search shows results dropdown', async ({ page }) => {
    // Requires: authenticated session + seeded DB with contacts/leads/opportunities
    await page.goto('/overview')
    const searchInput = page.getByPlaceholder('Search contacts, leads, opportunities...')
    await searchInput.fill('Alice')
    // Wait for debounced query (DEBOUNCE_MS = 300ms in global-search.tsx)
    await page.waitForTimeout(500)
    // Results dropdown should appear with entity type badges
    const resultsDropdown = page.getByLabel('Search results')
    await expect(resultsDropdown).toBeVisible()
  })

  test('empty search query shows no dropdown', async ({ page }) => {
    // Requires authenticated session
    await page.goto('/overview')
    const searchInput = page.getByPlaceholder('Search contacts, leads, opportunities...')
    await searchInput.fill('')
    const resultsDropdown = page.getByLabel('Search results')
    await expect(resultsDropdown).not.toBeVisible()
  })

  test('search with no matches shows "No results found" message', async ({ page }) => {
    // Requires: authenticated session + seeded DB
    await page.goto('/overview')
    const searchInput = page.getByPlaceholder('Search contacts, leads, opportunities...')
    await searchInput.fill('zzz_nonexistent_entity_zzz')
    await page.waitForTimeout(500)
    await expect(page.getByText('No results found.')).toBeVisible()
  })

  test('clicking a search result navigates to entity page', async ({ page }) => {
    // Requires: authenticated session + seeded DB with at least one contact
    await page.goto('/overview')
    const searchInput = page.getByPlaceholder('Search contacts, leads, opportunities...')
    await searchInput.fill('Alice')
    await page.waitForTimeout(500)
    const resultsDropdown = page.getByLabel('Search results')
    await expect(resultsDropdown).toBeVisible()
    // Click the first result
    const firstResult = resultsDropdown.locator('button').first()
    await firstResult.click()
    // Should navigate away from overview — the exact URL depends on entity type
    await expect(page).not.toHaveURL(/\/overview/)
  })

  test('search results show entity type badges (Contact, Lead, Opportunity)', async ({ page }) => {
    // Requires: authenticated session + seeded DB with mixed entity types
    await page.goto('/overview')
    const searchInput = page.getByPlaceholder('Search contacts, leads, opportunities...')
    await searchInput.fill('test')
    await page.waitForTimeout(500)
    const resultsDropdown = page.getByLabel('Search results')
    await expect(resultsDropdown).toBeVisible()
    // At least one badge type should be visible
    await expect(resultsDropdown.getByText(/Contact|Lead|Opportunity/).first()).toBeVisible()
  })
})

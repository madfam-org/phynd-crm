import { expect, requireAuthBypass, gotoDashboard, test } from './fixtures/auth'

const SEARCH_PLACEHOLDER = 'Search contacts, leads, opportunities...'

async function getVisibleSearchInput(page: import('@playwright/test').Page) {
  const searchInput = page.getByPlaceholder(SEARCH_PLACEHOLDER)
  await expect(searchInput).toBeVisible()
  await expect(searchInput).toBeEnabled()
  return searchInput
}

async function expectShortcutFocusesSearch(page: import('@playwright/test').Page, shortcut: string) {
  const searchInput = await getVisibleSearchInput(page)

  await expect(async () => {
    await page.keyboard.press(shortcut)
    await expect(searchInput).toBeFocused({ timeout: 500 })
  }).toPass({ timeout: 5000 })
}

test.describe('Global Search', () => {
  test.beforeEach(async ({ page }) => {
    requireAuthBypass()
    await gotoDashboard(page, '/overview')
  })

  test('search input is visible in header', async ({ page }) => {
    const searchInput = page.getByPlaceholder(SEARCH_PLACEHOLDER)
    await expect(searchInput).toBeVisible()
  })

  test('search input has accessible label', async ({ page }) => {
    const searchInput = page.getByLabel('Global search')
    await expect(searchInput).toBeVisible()
  })

  test('keyboard shortcut hint is displayed', async ({ page }) => {
    const kbdHint = page.locator('kbd')
    await expect(kbdHint).toBeVisible()
  })

  test('Cmd+K focuses search input', async ({ page }) => {
    await expectShortcutFocusesSearch(page, 'Meta+KeyK')
  })

  test('Ctrl+K focuses search input on non-Mac platforms', async ({ page }) => {
    await expectShortcutFocusesSearch(page, 'Control+KeyK')
  })

  test('typing in search shows results dropdown', async ({ page }) => {
    const searchInput = page.getByPlaceholder(SEARCH_PLACEHOLDER)
    await searchInput.fill('Alice')
    await page.waitForTimeout(500)
    const resultsDropdown = page.getByLabel('Search results')
    await expect(resultsDropdown).toBeVisible()
  })

  test('empty search query shows no dropdown', async ({ page }) => {
    const searchInput = page.getByPlaceholder(SEARCH_PLACEHOLDER)
    await searchInput.fill('')
    const resultsDropdown = page.getByLabel('Search results')
    await expect(resultsDropdown).not.toBeVisible()
  })

  test('search with no matches shows "No results found" message', async ({ page }) => {
    const searchInput = page.getByPlaceholder(SEARCH_PLACEHOLDER)
    await searchInput.fill('zzz_nonexistent_entity_zzz')
    await page.waitForTimeout(500)
    await expect(page.getByText('No results found.')).toBeVisible()
  })

  test('clicking a search result navigates to entity page', async ({ page }) => {
    const searchInput = page.getByPlaceholder(SEARCH_PLACEHOLDER)
    await searchInput.fill('Alice')
    await page.waitForTimeout(500)
    const resultsDropdown = page.getByLabel('Search results')
    await expect(resultsDropdown).toBeVisible()
    const firstResult = resultsDropdown.locator('button').first()
    await firstResult.click()
    await expect(page).not.toHaveURL(/\/overview/)
  })

  test('search results show entity type badges (Contact, Lead, Opportunity)', async ({ page }) => {
    const searchInput = page.getByPlaceholder(SEARCH_PLACEHOLDER)
    await searchInput.fill('TechCorp')
    await page.waitForTimeout(500)
    const resultsDropdown = page.getByLabel('Search results')
    await expect(resultsDropdown).toBeVisible()
    await expect(resultsDropdown.getByText(/Contact|Lead|Opportunity/).first()).toBeVisible()
  })
})

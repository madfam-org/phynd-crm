import { expect, test } from '@playwright/test'

test.describe('Accessibility', () => {
  test('marketing landing page has proper heading hierarchy', async ({ page }) => {
    await page.goto('/')
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
  })

  test('login page has accessible sign-in button', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Sign in with Janua' })).toBeVisible()
  })

  test('marketing page images have alt text or are decorative', async ({ page }) => {
    await page.goto('/')
    const images = page.locator('img')
    const count = await images.count()
    for (let i = 0; i < count; i++) {
      const img = images.nth(i)
      const alt = await img.getAttribute('alt')
      const ariaHidden = await img.getAttribute('aria-hidden')
      const role = await img.getAttribute('role')
      expect(alt !== null || ariaHidden === 'true' || role === 'presentation').toBe(true)
    }
  })

  test('marketing page SVGs are decorative (aria-hidden)', async ({ page }) => {
    await page.goto('/')
    const svgs = page.locator('svg')
    const count = await svgs.count()
    for (let i = 0; i < count; i++) {
      const svg = svgs.nth(i)
      const ariaHidden = await svg.getAttribute('aria-hidden')
      const role = await svg.getAttribute('role')
      const title = svg.locator('title')
      const hasTitle = (await title.count()) > 0
      expect(ariaHidden === 'true' || role === 'img' || hasTitle).toBe(true)
    }
  })
})

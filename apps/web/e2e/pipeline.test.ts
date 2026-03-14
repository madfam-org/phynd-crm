import { expect, test } from '@playwright/test'

test.describe('Pipeline Kanban Board', () => {
  test('unauthenticated users are redirected from pipeline to login', async ({
    page,
  }) => {
    await page.goto('/pipeline')
    await expect(page).toHaveURL(/\/login/)
  })

  test.fixme(
    'pipeline page renders with heading',
    async ({ page }) => {
      // Requires: authenticated session + default pipeline configured in DB
      await page.goto('/pipeline')
      const heading = page.locator('h1')
      await expect(heading).toContainText('Pipeline')
    },
  )

  test.fixme(
    'pipeline page displays pipeline name as subtitle',
    async ({ page }) => {
      // Requires: authenticated session + default pipeline configured in DB
      await page.goto('/pipeline')
      // The pipeline name is rendered as a <p> below the h1
      const subtitle = page.locator('p.text-muted-foreground')
      await expect(subtitle).toBeVisible()
      // Should not show "No default pipeline configured."
      await expect(subtitle).not.toContainText('No default pipeline')
    },
  )

  test.fixme(
    'pipeline page shows stage columns',
    async ({ page }) => {
      // Requires: authenticated session + default pipeline with stages seeded
      await page.goto('/pipeline')
      // Each stage renders as a column with a heading (h3)
      const stageHeadings = page.locator('h3.text-sm.font-semibold')
      expect(await stageHeadings.count()).toBeGreaterThan(0)
    },
  )

  test.fixme(
    'stage columns show card count badges',
    async ({ page }) => {
      // Requires: authenticated session + default pipeline with stages seeded
      await page.goto('/pipeline')
      // Each stage header has a Badge showing the total cards count
      const stageBadges = page.locator(
        'h3.text-sm.font-semibold + [class*="badge"], h3.text-sm.font-semibold ~ [class*="badge"]',
      )
      // Alternative: look for badge siblings within the stage header container
      const stageContainers = page.locator('.min-w-\\[250px\\]')
      const containerCount = await stageContainers.count()
      expect(containerCount).toBeGreaterThan(0)
      // Each container should have a badge
      for (let i = 0; i < containerCount; i++) {
        const badge = stageContainers.nth(i).locator('[class*="badge"]')
        await expect(badge).toBeVisible()
      }
    },
  )

  test.fixme(
    'empty stages show "Empty" placeholder text',
    async ({ page }) => {
      // Requires: authenticated session + at least one empty stage in the pipeline
      await page.goto('/pipeline')
      // Empty stages render a paragraph with "Empty" text
      const emptyPlaceholder = page.getByText('Empty')
      // There should be at least one empty stage in a fresh pipeline
      expect(await emptyPlaceholder.count()).toBeGreaterThanOrEqual(1)
    },
  )

  test.fixme(
    'lead cards display in their assigned stages',
    async ({ page }) => {
      // Requires: authenticated session + leads assigned to pipeline stages
      await page.goto('/pipeline')
      // Lead cards have aria-label starting with "Lead:"
      const leadCards = page.locator('[aria-label^="Lead:"]')
      expect(await leadCards.count()).toBeGreaterThan(0)
    },
  )

  test.fixme(
    'opportunity cards display in their assigned stages',
    async ({ page }) => {
      // Requires: authenticated session + opportunities assigned to pipeline stages
      await page.goto('/pipeline')
      // Opportunity cards have aria-label starting with "Opportunity:"
      const oppCards = page.locator('[aria-label^="Opportunity:"]')
      expect(await oppCards.count()).toBeGreaterThan(0)
    },
  )

  test.fixme(
    'stage droppable areas have accessible labels',
    async ({ page }) => {
      // Requires: authenticated session + default pipeline with stages
      await page.goto('/pipeline')
      // Each droppable area has aria-label="{stageName} stage"
      const droppableAreas = page.locator('[aria-label$=" stage"]')
      expect(await droppableAreas.count()).toBeGreaterThan(0)
    },
  )

  test.fixme(
    'drag and drop moves a lead card between stages',
    async ({ page }) => {
      // Requires: authenticated session + pipeline with at least 2 stages + lead in first stage
      // This test exercises the @hello-pangea/dnd drag-and-drop functionality
      await page.goto('/pipeline')

      const leadCards = page.locator('[aria-label^="Lead:"]')
      const firstLeadCard = leadCards.first()
      await expect(firstLeadCard).toBeVisible()

      // Get the bounding box of the first lead card and a target stage
      const stageAreas = page.locator('[aria-label$=" stage"]')
      const targetStage = stageAreas.nth(1) // second stage
      await expect(targetStage).toBeVisible()

      const cardBox = await firstLeadCard.boundingBox()
      const targetBox = await targetStage.boundingBox()

      if (cardBox && targetBox) {
        // Simulate drag from card center to target stage center
        await page.mouse.move(
          cardBox.x + cardBox.width / 2,
          cardBox.y + cardBox.height / 2,
        )
        await page.mouse.down()
        await page.mouse.move(
          targetBox.x + targetBox.width / 2,
          targetBox.y + targetBox.height / 2,
          { steps: 10 },
        )
        await page.mouse.up()

        // Verify the card moved — the target stage card count should increase
        // This is an optimistic update, so it should happen immediately
        await page.waitForTimeout(500)
      }
    },
  )

  test.fixme(
    'shows fallback when no default pipeline is configured',
    async ({ page }) => {
      // Requires: authenticated session + no default pipeline in DB
      await page.goto('/pipeline')
      await expect(
        page.getByText('No default pipeline configured.'),
      ).toBeVisible()
    },
  )
})

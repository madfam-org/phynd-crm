import { expect, test } from '@playwright/test'

test.describe('Bulk Operations', () => {
  test.describe('contacts table', () => {
    test('unauthenticated users are redirected from contacts to login', async ({
      page,
    }) => {
      await page.goto('/contacts')
      await expect(page).toHaveURL(/\/login/)
    })

    test.fixme(
      'contacts table renders with selectable checkboxes',
      async ({ page }) => {
        // Requires: authenticated session + seeded contacts
        await page.goto('/contacts')
        // The DataTable with selectable=true renders a "Select all rows" checkbox in the header
        const selectAllCheckbox = page.getByLabel('Select all rows')
        await expect(selectAllCheckbox).toBeVisible()
      },
    )

    test.fixme(
      'individual row checkboxes are visible in contacts table',
      async ({ page }) => {
        // Requires: authenticated session + seeded contacts
        await page.goto('/contacts')
        // Each row has a checkbox with aria-label="Select row {key}"
        const rowCheckboxes = page.locator(
          '[aria-label^="Select row"]',
        )
        expect(await rowCheckboxes.count()).toBeGreaterThan(0)
      },
    )

    test.fixme(
      'selecting a contact row shows bulk actions toolbar',
      async ({ page }) => {
        // Requires: authenticated session + seeded contacts
        await page.goto('/contacts')
        // BulkActionsToolbar is hidden when selectedCount === 0
        await expect(page.getByText('selected')).not.toBeVisible()
        // Click the first row checkbox
        const firstCheckbox = page
          .locator('[aria-label^="Select row"]')
          .first()
        await firstCheckbox.click()
        // Toolbar should appear with "1 selected" text
        await expect(page.getByText('1 selected')).toBeVisible()
      },
    )

    test.fixme(
      'select all checkbox selects all visible contact rows',
      async ({ page }) => {
        // Requires: authenticated session + seeded contacts
        await page.goto('/contacts')
        const selectAll = page.getByLabel('Select all rows')
        await selectAll.click()
        // All row checkboxes should now be checked
        const rowCheckboxes = page.locator(
          '[aria-label^="Select row"]',
        )
        const count = await rowCheckboxes.count()
        await expect(
          page.getByText(`${count} selected`),
        ).toBeVisible()
      },
    )

    test.fixme(
      'contacts export CSV button is visible when rows are selected',
      async ({ page }) => {
        // Requires: authenticated session + seeded contacts
        await page.goto('/contacts')
        // Select a row to trigger the bulk actions toolbar
        const firstCheckbox = page
          .locator('[aria-label^="Select row"]')
          .first()
        await firstCheckbox.click()
        // The contacts BulkActionsToolbar includes an Export CSV button
        const exportButton = page.getByRole('button', {
          name: 'Export CSV',
        })
        await expect(exportButton).toBeVisible()
      },
    )

    test.fixme(
      'CSV export triggers a file download',
      async ({ page }) => {
        // Requires: authenticated session + seeded contacts
        await page.goto('/contacts')
        // Select a row
        const firstCheckbox = page
          .locator('[aria-label^="Select row"]')
          .first()
        await firstCheckbox.click()
        // Listen for the download event
        const downloadPromise = page.waitForEvent('download')
        await page
          .getByRole('button', { name: 'Export CSV' })
          .click()
        const download = await downloadPromise
        // Verify the downloaded file has the expected name pattern
        expect(download.suggestedFilename()).toMatch(
          /contacts.*\.csv/,
        )
      },
    )
  })

  test.describe('leads table', () => {
    test('unauthenticated users are redirected from leads to login', async ({
      page,
    }) => {
      await page.goto('/leads')
      await expect(page).toHaveURL(/\/login/)
    })

    test.fixme(
      'leads table renders with selectable checkboxes',
      async ({ page }) => {
        // Requires: authenticated session + seeded leads
        await page.goto('/leads')
        const selectAllCheckbox = page.getByLabel('Select all rows')
        await expect(selectAllCheckbox).toBeVisible()
      },
    )

    test.fixme(
      'selecting lead rows shows bulk actions toolbar with status change option',
      async ({ page }) => {
        // Requires: authenticated session + seeded leads
        await page.goto('/leads')
        // Select a lead row
        const firstCheckbox = page
          .locator('[aria-label^="Select row"]')
          .first()
        await firstCheckbox.click()
        // BulkActionsToolbar should show "Change Status" button
        const changeStatusButton = page.getByRole('button', {
          name: 'Change Status',
        })
        await expect(changeStatusButton).toBeVisible()
        // Export CSV button should also be visible
        const exportButton = page.getByRole('button', {
          name: 'Export CSV',
        })
        await expect(exportButton).toBeVisible()
      },
    )

    test.fixme(
      'selecting lead rows shows status selector dropdown',
      async ({ page }) => {
        // Requires: authenticated session + seeded leads
        await page.goto('/leads')
        // Select a lead row to trigger the bulk status selector
        const firstCheckbox = page
          .locator('[aria-label^="Select row"]')
          .first()
        await firstCheckbox.click()
        // A Select component with "Select status..." placeholder should appear
        await expect(
          page.getByText('Select status...'),
        ).toBeVisible()
      },
    )

    test.fixme(
      'bulk status change updates selected leads',
      async ({ page }) => {
        // Requires: authenticated session + seeded leads with "new" status
        await page.goto('/leads')
        // Select the first lead
        const firstCheckbox = page
          .locator('[aria-label^="Select row"]')
          .first()
        await firstCheckbox.click()
        // Open the status selector and choose "contacted"
        await page.getByText('Select status...').click()
        await page.getByRole('option', { name: 'contacted' }).click()
        // Click "Change Status" to apply
        await page
          .getByRole('button', { name: 'Change Status' })
          .click()
        // After successful mutation, selection should be cleared
        // and a success toast "Leads updated" should appear
        await expect(
          page.getByText('Leads updated'),
        ).toBeVisible()
      },
    )
  })

  test.describe('opportunities table', () => {
    test('unauthenticated users are redirected from opportunities to login', async ({
      page,
    }) => {
      await page.goto('/opportunities')
      await expect(page).toHaveURL(/\/login/)
    })

    test.fixme(
      'opportunities table renders with selectable checkboxes',
      async ({ page }) => {
        // Requires: authenticated session + seeded opportunities
        await page.goto('/opportunities')
        const selectAllCheckbox = page.getByLabel('Select all rows')
        await expect(selectAllCheckbox).toBeVisible()
      },
    )

    test.fixme(
      'selecting opportunity rows shows bulk actions toolbar',
      async ({ page }) => {
        // Requires: authenticated session + seeded opportunities
        await page.goto('/opportunities')
        const firstCheckbox = page
          .locator('[aria-label^="Select row"]')
          .first()
        await firstCheckbox.click()
        // Should show "Change Status" and "Export CSV" buttons
        await expect(
          page.getByRole('button', { name: 'Change Status' }),
        ).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Export CSV' }),
        ).toBeVisible()
      },
    )

    test.fixme(
      'deselecting all rows hides bulk actions toolbar',
      async ({ page }) => {
        // Requires: authenticated session + seeded opportunities
        await page.goto('/opportunities')
        const firstCheckbox = page
          .locator('[aria-label^="Select row"]')
          .first()
        // Select
        await firstCheckbox.click()
        await expect(page.getByText('1 selected')).toBeVisible()
        // Deselect
        await firstCheckbox.click()
        await expect(
          page.getByText('selected'),
        ).not.toBeVisible()
      },
    )
  })

  test.describe('data table interaction patterns', () => {
    test.fixme(
      'select-all with search filter only selects visible rows',
      async ({ page }) => {
        // Requires: authenticated session + seeded contacts with varied data
        // The DataTable component filters data client-side. Select-all should only
        // toggle selection for rows that pass the current search/filter criteria.
        await page.goto('/contacts')
        // Type a search to filter the table
        const searchInput = page.getByPlaceholder('Search...')
        await searchInput.fill('alice')
        // Select all visible rows
        const selectAll = page.getByLabel('Select all rows')
        await selectAll.click()
        // The selected count should match the filtered row count, not total rows
        const selectedText = page.locator(
          'text=/\\d+ selected/',
        )
        await expect(selectedText).toBeVisible()
      },
    )

    test.fixme(
      'selected rows have data-state="selected" attribute',
      async ({ page }) => {
        // Requires: authenticated session + seeded contacts
        await page.goto('/contacts')
        const firstCheckbox = page
          .locator('[aria-label^="Select row"]')
          .first()
        await firstCheckbox.click()
        // The selected TableRow should have data-state="selected"
        const selectedRow = page.locator('tr[data-state="selected"]')
        expect(await selectedRow.count()).toBe(1)
      },
    )
  })
})

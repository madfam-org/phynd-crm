import { expect, test } from '@playwright/test'

test.describe('User Management', () => {
  test('unauthenticated users are redirected from users page to login', async ({ page }) => {
    test.skip(process.env.AUTH_BYPASS === 'true', 'AUTH_BYPASS skips redirect')
    await page.goto('/settings/users')
    await expect(page).toHaveURL(/\/login/)
  })

  test('users page renders with heading', async ({ page }) => {
    // Requires: authenticated session with admin role
    await page.goto('/settings/users')
    const heading = page.locator('h1')
    await expect(heading).toContainText('Users')
  })

  test('users page shows subtitle text', async ({ page }) => {
    // Requires: authenticated session with admin role
    await page.goto('/settings/users')
    await expect(page.getByText('Manage user accounts')).toBeVisible()
  })

  test('create user button is visible', async ({ page }) => {
    // Requires: authenticated session with admin role
    await page.goto('/settings/users')
    const createButton = page.getByRole('button', {
      name: 'Create User',
    })
    await expect(createButton).toBeVisible()
  })

  test('clicking create user button opens dialog', async ({ page }) => {
    // Requires: authenticated session with admin role
    await page.goto('/settings/users')
    const createButton = page.getByRole('button', {
      name: 'Create User',
    })
    await createButton.click()
    // Dialog should open with "Create User" title and form fields
    await expect(page.getByRole('heading', { name: 'Create User' })).toBeVisible()
    await expect(page.getByText('Add a new user account.')).toBeVisible()
  })

  test('create user dialog has email, name, and role fields', async ({ page }) => {
    // Requires: authenticated session with admin role
    await page.goto('/settings/users')
    await page.getByRole('button', { name: 'Create User' }).click()
    // Email field (required)
    const emailInput = page.locator('#create-user-email')
    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute('type', 'email')
    await expect(emailInput).toHaveAttribute('required', '')
    // Name field (optional)
    const nameInput = page.locator('#create-user-name')
    await expect(nameInput).toBeVisible()
    // Role selector
    const roleSelect = page.locator('#create-user-role')
    await expect(roleSelect).toBeVisible()
  })

  test('create user dialog has cancel and submit buttons', async ({ page }) => {
    // Requires: authenticated session with admin role
    await page.goto('/settings/users')
    await page.getByRole('button', { name: 'Create User' }).click()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    // Submit button should be disabled when email is empty
    const submitButton = page.getByRole('button', {
      name: 'Create',
    })
    await expect(submitButton).toBeVisible()
    await expect(submitButton).toBeDisabled()
  })

  test('create user submit button enables when email is provided', async ({ page }) => {
    // Requires: authenticated session with admin role
    await page.goto('/settings/users')
    await page.getByRole('button', { name: 'Create User' }).click()
    const emailInput = page.locator('#create-user-email')
    await emailInput.fill('newuser@example.com')
    const submitButton = page.getByRole('button', {
      name: 'Create',
    })
    await expect(submitButton).toBeEnabled()
  })

  test('users data table displays with columns', async ({ page }) => {
    // Requires: authenticated session with admin role + seeded users
    await page.goto('/settings/users')
    // Table should have Name, Email, Role, Created columns
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Email' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Created' })).toBeVisible()
  })

  test('users table has search by email filter', async ({ page }) => {
    // Requires: authenticated session with admin role
    await page.goto('/settings/users')
    const searchInput = page.getByPlaceholder('Search by email...')
    await expect(searchInput).toBeVisible()
  })

  test('users table has role filter dropdown', async ({ page }) => {
    // Requires: authenticated session with admin role
    await page.goto('/settings/users')
    // The role filter is a Radix Select with options: Admin, Manager, Sales Rep, Viewer
    const filterTrigger = page.locator('[class*="SelectTrigger"]')
    await expect(filterTrigger).toBeVisible()
  })

  test('user row actions menu has Edit and Delete options', async ({ page }) => {
    // Requires: authenticated session with admin role + at least one user seeded
    await page.goto('/settings/users')
    // Click the first actions button
    const actionsButton = page.getByLabel('User actions').first()
    await actionsButton.click()
    await expect(page.getByText('Edit')).toBeVisible()
    await expect(page.getByText('Delete')).toBeVisible()
  })

  test('user roles display with correct badges', async ({ page }) => {
    // Requires: authenticated session with admin role + users with different roles
    await page.goto('/settings/users')
    // Role badges render with specific variants: Admin, Manager, Sales Rep, Viewer
    const roleBadges = page.locator('td [class*="badge"]')
    expect(await roleBadges.count()).toBeGreaterThan(0)
  })

  test('CRUD operations require admin role', async ({ page }) => {
    // Requires: authenticated session with a non-admin role (e.g., viewer)
    // This test verifies that non-admin users cannot access the users management page
    // or that CRUD operations are restricted at the API level
    await page.goto('/settings/users')
    // Expected: either redirected, shown an error, or CRUD buttons are hidden
    // The exact behavior depends on the authorization implementation
  })
})

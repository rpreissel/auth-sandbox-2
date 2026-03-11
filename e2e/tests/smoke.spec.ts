import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

const AUTH_API_URL = 'https://auth.localhost:8443'
const KEYCLOAK_METADATA_URL = 'https://keycloak.localhost:8443/realms/auth-sandbox-2/.well-known/openid-configuration'
const DB_VIEWER_URL = 'https://db.localhost:8443'

async function waitForRuntimeReady(request: APIRequestContext) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const [healthResponse, metadataResponse] = await Promise.all([
      request.get(`${AUTH_API_URL}/api/health`),
      request.get(KEYCLOAK_METADATA_URL)
    ])

    if (healthResponse.ok() && metadataResponse.ok()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error('Runtime did not become ready for E2E tests')
}

test.beforeEach(async ({ request }) => {
  await waitForRuntimeReady(request)
})

test('shared postgres runtime exposes auth and keycloak endpoints', async ({ request }) => {
  const [healthResponse, metadataResponse] = await Promise.all([
    request.get(`${AUTH_API_URL}/api/health`),
    request.get(KEYCLOAK_METADATA_URL)
  ])

  expect(healthResponse.ok()).toBeTruthy()
  expect(metadataResponse.ok()).toBeTruthy()
})

test('postgres viewer login is reachable', async ({ page }) => {
  await page.goto(DB_VIEWER_URL)
  await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible()
  await expect(page.getByRole('combobox').first()).toContainText('PostgreSQL')
  await expect(page.getByPlaceholder('localhost')).toHaveValue('postgres')
  await expect(page.getByRole('textbox').nth(1)).toBeVisible()
  await expect(page.getByRole('textbox').nth(2)).toBeVisible()
  await expect(page.getByRole('textbox').nth(3)).toBeVisible()
})

test('homepage contains key links', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /minimal device-login sandbox/i })).toBeVisible()
  const appWebLink = page.getByRole('link', { name: /app web/i })
  const dbViewerLink = page.getByRole('link', { name: /db viewer/i })
  await expect(appWebLink).toBeVisible()
  await expect(dbViewerLink).toBeVisible()
  await expect(appWebLink).toHaveAttribute('target', '_blank')
  await expect(dbViewerLink).toHaveAttribute('target', '_blank')
  await expect(page.getByRole('heading', { name: /db viewer login/i })).toBeVisible()
  await expect(page.getByText('auth_sandbox_2')).toBeVisible()
  await expect(page.getByText('auth_api, keycloak')).toBeVisible()
  await expect(page.getByRole('heading', { name: /sequence diagrams/i })).toBeVisible()
  await expect(page.getByText('Registration and device setup')).toBeVisible()
  await expect(page.getByText('Encrypted login and token lifecycle')).toBeVisible()
})

test('device login flow supports tokens refresh and logout', async ({ page, request }) => {
  const userId = `e2e-user-${Date.now()}`
  const registrationResponse = await request.post(`${AUTH_API_URL}/api/admin/registration-codes`, {
    data: {
      userId,
      displayName: 'E2E User',
      validForDays: 30
    }
  })

  expect(registrationResponse.ok()).toBeTruthy()
  const registration = await registrationResponse.json()

  await page.goto('https://app.localhost:8443')
  await page.getByLabel('User ID').fill(userId)
  await page.getByLabel('Device name').fill('Playwright Device')
  await page.getByLabel('Activation code').fill(registration.code)
  await page.getByRole('button', { name: 'Register device' }).click()

  await expect(page.getByText('Device registered: Playwright Device')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Set password' })).toBeVisible()

  await page.getByLabel('Initial password').fill('ChangeMe123!')
  await page.getByRole('button', { name: 'Set password' }).click()

  await expect(page.getByText('Password set')).toBeVisible()
  await page.getByRole('button', { name: 'Start login' }).click()
  await expect(page.getByText('Challenge received')).toBeVisible()

  await page.getByRole('button', { name: 'Finish login' }).click()
  await expect(page.getByText('Authenticated with Keycloak tokens')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Access token' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'ID token' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Refresh token' })).toBeVisible()
  const claimSummary = page.getByLabel('Token claim summary')
  await expect(claimSummary).toBeVisible()
  await expect(claimSummary.locator('article').filter({ hasText: 'User ID' }).locator('strong')).toHaveText(userId)
  await expect(claimSummary.locator('article').filter({ hasText: 'Username' }).locator('strong')).toHaveText(userId)
  await expect(claimSummary.locator('article').filter({ hasText: 'Subject' }).locator('strong')).not.toBeEmpty()
  await expect(claimSummary.locator('article').filter({ hasText: 'Roles' }).locator('strong')).not.toBeEmpty()
  await expect(claimSummary.locator('article').filter({ hasText: 'Expires' }).locator('strong')).not.toBeEmpty()

  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.getByText('Tokens refreshed')).toBeVisible()

  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByText('Logged out')).toBeVisible()
  await expect(page.getByText('No Keycloak tokens yet.')).toBeVisible()
})

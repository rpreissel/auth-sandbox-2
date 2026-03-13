import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

const AUTH_API_URL = 'https://auth.localhost:8443'
const KEYCLOAK_METADATA_URL = 'https://keycloak.localhost:8443/realms/auth-sandbox-2/.well-known/openid-configuration'
const DB_VIEWER_URL = 'https://db.localhost:8443'
const ADMIN_WEB_URL = 'https://admin.localhost:8443'

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
  await expect(page.getByRole('heading', { name: 'Set up this phone' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Set up device sign-in' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tokens', exact: true })).toBeVisible()
  await expect(page.getByLabel('Token wallet empty state')).toContainText('Tokens appear here after device login.')
  await page.getByLabel('User ID').fill(userId)
  await page.getByLabel('Device name').fill('Playwright Device')
  await page.getByLabel('Activation code').fill(registration.code)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await expect(page.getByText("Verify it's you")).toBeVisible()
  await expect(page.getByText('Android Security', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Use screen lock' }).click()

  await expect(page.getByText('Device binding saved. Create a new Keycloak password to continue.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create your new password' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save password' })).toBeVisible()

  await page.getByLabel('New password').fill('ChangeMe123!')
  await page.getByRole('button', { name: 'Save password' }).click()

  await expect(page.getByText('Approve keychain access to finish automatic sign-in')).toBeVisible()
  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await expect(page.getByText("Verify it's you")).toBeVisible()
  await page.getByRole('button', { name: 'Use screen lock' }).click()

  await expect(page.getByRole('heading', { name: 'Playwright Device' })).toBeVisible()
  await expect(page.getByText('Signed in and ready')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Session tokens' })).toBeVisible()
  await expect(page.getByLabel('Token overview cards')).toContainText('Access')
  const bindingNotice = page.getByRole('note', { name: 'Local device binding notice' })
  await expect(page.getByRole('button', { name: 'Refresh tokens' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'This phone is ready' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sign in with saved device' })).toBeVisible()
  await expect(page.getByText(userId)).toBeVisible()
  await expect(page.getByText('Playwright Device')).toBeVisible()
  await expect(bindingNotice).toBeVisible()
  await expect(bindingNotice).toContainText('private key stays on this device')
  await expect(page.getByRole('button', { name: 'Continue with device' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove device binding' })).toBeVisible()

  await page.getByRole('button', { name: 'Continue with device' }).click()
  await expect(page.getByText('Approve keychain access to sign in')).toBeVisible()
  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await expect(page.getByText("Verify it's you")).toBeVisible()
  await page.getByRole('button', { name: 'Use screen lock' }).click()

  await expect(page.getByRole('heading', { name: 'Playwright Device' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Access and ID tokens' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Userinfo endpoint' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Introspection endpoint' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Refresh token' })).toBeVisible()
  await expect(page.getByLabel('Authenticated token summary')).toContainText('Token type')
  const userInfoPanel = page.locator('.token-panel').filter({ has: page.getByRole('heading', { name: 'Userinfo endpoint' }) })
  const introspectionPanel = page.locator('.token-panel').filter({ has: page.getByRole('heading', { name: 'Introspection endpoint' }) })
  const userInfoSummary = page.getByLabel('Userinfo endpoint summary')
  const introspectionSummary = page.getByLabel('Introspection endpoint summary')
  await expect(userInfoSummary).toContainText('Username')
  await expect(userInfoSummary).toContainText(userId)
  await expect(introspectionSummary).toContainText('Active')
  await expect(introspectionSummary).toContainText('Yes')
  await userInfoPanel.getByText('Userinfo response JSON').click()
  await expect(userInfoPanel.getByRole('textbox')).toContainText(userId)
  await introspectionPanel.getByText('Introspection response JSON').click()
  await expect(introspectionPanel.getByRole('textbox')).toContainText('active')
  await page.getByText('Decoded token details').click()
  const claimSummary = page.getByLabel('Token claim summary')
  const comparisonClaimsTable = page.getByRole('table', { name: 'Access and ID token claims' })
  await expect(claimSummary).toBeVisible()
  await expect(comparisonClaimsTable).toBeVisible()
  await expect(comparisonClaimsTable.getByRole('row', { name: /exp/i })).toContainText('Unix')
  await expect(page.locator('summary').filter({ hasText: 'token JWT' })).toHaveCount(3)
  await expect(comparisonClaimsTable.getByRole('row', { name: /email_verified/i })).toContainText('false')
  await expect(claimSummary.locator('article').filter({ hasText: 'User ID' }).locator('strong')).toHaveText(userId)
  await expect(claimSummary.locator('article').filter({ hasText: 'Username' }).locator('strong')).toHaveText(userId)
  await expect(claimSummary.locator('article').filter({ hasText: 'Session ID' }).locator('strong')).not.toBeEmpty()
  await expect(claimSummary.locator('article').filter({ hasText: 'Roles' }).locator('strong')).not.toBeEmpty()
  await expect(claimSummary.locator('article').filter({ hasText: 'Ends' }).locator('strong')).not.toBeEmpty()

  await page.getByRole('button', { name: 'Refresh tokens' }).click()
  await expect(page.getByText('Tokens refreshed')).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Signed out. This phone is still ready to sign in again.')).toBeVisible()
  await expect(page.getByText('No Keycloak tokens yet.')).toBeVisible()

  await page.getByRole('button', { name: 'Remove device binding' }).click()
  await expect(page.getByText('Device binding removed from this phone')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  await expect(bindingNotice).toHaveCount(0)

  await page.goto(`${ADMIN_WEB_URL}/#trace-browser`)
  await expect(page.getByRole('heading', { name: /scan flows quickly, keep the selected summary visible, and open deep inspection only when needed/i })).toBeVisible()
  await expect(page.getByText(/demo mode captures all payloads/i)).toBeVisible()

  const traceList = page.getByRole('list', { name: 'Trace list' })
  await expect(traceList).toContainText(/device_login_finish|device_login_finished/i)
  await expect(traceList).toBeVisible()

  await expect(page.getByRole('heading', { name: 'Selected trace' })).toBeVisible()
  await traceList.getByRole('button', { name: /device_login_finish|device_login_finished/i }).first().click()
  await expect(page.getByRole('button', { name: 'Open deep inspection' })).toBeVisible()
  await expect(page.getByText(/selected trace stays visible on the right/i)).toBeVisible()
  await expect(traceList.getByText(/Started .* UTC/i).first()).toBeVisible()
  await page.getByRole('button', { name: 'Open deep inspection' }).click()

  await expect(page).toHaveURL(/#trace\//)
  await expect(page.getByRole('heading', { name: /deep trace inspection|device_login_finish|device_login_finished/i })).toBeVisible()
  await expect(page.getByText('Span and artifact detail')).toBeVisible()

  const timeline = page.getByRole('list', { name: 'Trace spans timeline' })
  await expect(timeline).toContainText('auth-api')
  await expect(timeline).toContainText('keycloak')
  await timeline.getByRole('button', { name: /keycloak/i }).first().click()

  const artifactList = page.getByRole('list', { name: 'Artifact list' })

  await expect(artifactList).toContainText('id_token')
  await artifactList.getByRole('button', { name: /id_token/i }).click()

  const artifactViewer = page.getByLabel('Artifact viewer')
  await expect(artifactViewer).toContainText('Decoded')
  await expect(artifactViewer).toContainText('Explained')
  await expect(artifactViewer).toContainText('Subject')
  await expect(artifactViewer).toContainText('Audience')
})

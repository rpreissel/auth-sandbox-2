import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

const AUTH_API_URL = 'https://auth.localhost:8443'
const MOCK_API_URL = 'https://mock.localhost:8443'
const TRACE_API_URL = 'https://trace.localhost:8443'
const KEYCLOAK_METADATA_URL = 'https://keycloak.localhost:8443/realms/auth-sandbox-2/.well-known/openid-configuration'
const DB_VIEWER_URL = 'https://db.localhost:8443'
const ADMIN_WEB_URL = 'https://admin.localhost:8443'
const TRACE_WEB_URL = 'https://admin.localhost:8443/trace/'

type TraceListItem = {
  traceId: string
  traceType: string
  actors: string[]
}

async function waitForRuntimeReady(request: APIRequestContext) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const [healthResponse, mockHealthResponse, traceHealthResponse, metadataResponse] = await Promise.all([
      request.get(`${AUTH_API_URL}/api/health`),
      request.get(`${MOCK_API_URL}/health`),
      request.get(`${TRACE_API_URL}/health`),
      request.get(KEYCLOAK_METADATA_URL)
    ])

    if (healthResponse.ok() && mockHealthResponse.ok() && traceHealthResponse.ok() && metadataResponse.ok()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error('Runtime did not become ready for E2E tests')
}

async function waitForUserLoginTrace(request: APIRequestContext, userId: string) {
  return waitForTrace(request, userId, 'device_login_finish', 'web-client')
}

async function waitForTrace(request: APIRequestContext, userId: string, traceType: string, actor: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const params = new URLSearchParams({
      userId,
      page: '1',
      pageSize: '20'
    })
    const response = await request.get(`${TRACE_API_URL}/traces?${params.toString()}`)

    if (response.ok()) {
      const body = await response.json() as { items: TraceListItem[] }
      const match = body.items.find((trace) => trace.traceType === traceType && trace.actors.includes(actor))
      if (match) {
        return match
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`No fresh ${traceType} trace found for ${userId}`)
}

test.beforeEach(async ({ request }) => {
  await waitForRuntimeReady(request)
})

test('shared postgres runtime exposes auth, trace, and keycloak endpoints', async ({ request }) => {
  const [healthResponse, mockHealthResponse, traceHealthResponse, metadataResponse] = await Promise.all([
    request.get(`${AUTH_API_URL}/api/health`),
    request.get(`${MOCK_API_URL}/health`),
    request.get(`${TRACE_API_URL}/health`),
    request.get(KEYCLOAK_METADATA_URL)
  ])

  expect(healthResponse.ok()).toBeTruthy()
  expect(mockHealthResponse.ok()).toBeTruthy()
  expect(traceHealthResponse.ok()).toBeTruthy()
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

test('admin overview is localized in German', async ({ page }) => {
  await page.goto(ADMIN_WEB_URL)

  await expect(page.getByRole('heading', { name: /verwalte registrierungscodes und behalte bestehende geraetebindungen im blick/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Registrierungscode erstellen' })).toBeVisible()
  await expect(page.getByText('Anzeigename')).toBeVisible()
  await expect(page.getByText('Gueltig fuer Tage')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Code erstellen' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Registrierungscodes', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Geraete', exact: true })).toBeVisible()
  await expect(page.getByLabel('Admin Ueberblickszahlen')).toContainText('Registrierungscodes')
  await expect(page.getByLabel('Admin Ueberblickszahlen')).toContainText('Geraete')
  await expect(page.getByLabel('Registrierungscodes durchsuchen')).toBeVisible()
  await expect(page.getByLabel('Geraete durchsuchen')).toBeVisible()
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
  test.setTimeout(45000)
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
  await expect(page.getByRole('heading', { name: 'Dieses Telefon einrichten' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Geräteanmeldung einrichten' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sitzungstokens', exact: true })).toBeVisible()
  await expect(page.getByLabel('Token wallet empty state')).toContainText('Tokens erscheinen hier nach der Geräteanmeldung.')
  await page.getByLabel('Benutzer-ID').fill(userId)
  await page.getByLabel('Gerätename').fill('Playwright Device')
  await page.getByLabel('Aktivierungscode').fill(registration.code)
  await page.getByRole('button', { name: 'Weiter' }).click()

  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await expect(page.getByText('Bestätige deine Identität')).toBeVisible()
  await expect(page.getByText('Android-Sicherheit', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()

  await expect(page.getByText('Gerätebindung gespeichert. Lege ein neues Keycloak-Passwort fest, um fortzufahren.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Neues Passwort erstellen' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Passwort speichern' })).toBeVisible()

  await page.getByLabel('Neues Passwort').fill('ChangeMe123!')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()

  await expect(page.getByText('Bestätige den Schlüsselspeicherzugriff, um die automatische Anmeldung abzuschließen')).toBeVisible()
  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await expect(page.getByText('Bestätige deine Identität')).toBeVisible()
  await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()

  await expect(page.getByRole('heading', { name: 'Playwright Device' })).toBeVisible()
  await expect(page.getByText('Angemeldet und bereit')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Aktive Sitzung' })).toBeVisible()
  await expect(page.getByLabel('Token overview cards')).toContainText('Zugriff')
  const bindingNotice = page.getByRole('note', { name: 'Local device binding notice' })
  await expect(page.getByRole('button', { name: 'Tokens aktualisieren' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dieses Telefon ist bereit' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mit gespeichertem Gerät anmelden' })).toBeVisible()
  await expect(page.getByText(userId)).toBeVisible()
  await expect(page.getByText('Playwright Device')).toBeVisible()
  await expect(bindingNotice).toBeVisible()
  await expect(bindingNotice).toContainText('private Schlüssel bleibt auf diesem Gerät')
  await expect(page.getByRole('button', { name: 'Mit Gerät fortfahren' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gerätebindung entfernen' })).toBeVisible()

  await page.getByRole('button', { name: 'Mit Gerät fortfahren' }).click()
  await expect(page.getByText('Bestätige den Schlüsselspeicherzugriff zur Anmeldung')).toBeVisible()
  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await expect(page.getByText('Bestätige deine Identität')).toBeVisible()
  await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()

  await expect(page.getByRole('heading', { name: 'Playwright Device' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Access- und ID-Token' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Token Sitzung' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Mock API Demo API' })).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByRole('heading', { name: 'Userinfo-Endpunkt' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Introspection-Endpunkt' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Refresh-Token' })).toBeVisible()
  await expect(page.getByLabel('Authenticated token summary')).toContainText('Token-Typ')
  const userInfoPanel = page.locator('.token-panel').filter({ has: page.getByRole('heading', { name: 'Userinfo-Endpunkt' }) })
  const introspectionPanel = page.locator('.token-panel').filter({ has: page.getByRole('heading', { name: 'Introspection-Endpunkt' }) })
  const userInfoSummary = page.getByLabel('Userinfo-Endpunkt summary')
  const introspectionSummary = page.getByLabel('Introspection-Endpunkt summary')
  await expect(userInfoSummary).toContainText('Benutzername')
  await expect(userInfoSummary).toContainText(userId)
  await expect(introspectionSummary).toContainText('Aktiv')
  await expect(introspectionSummary).toContainText('Ja')
  await userInfoPanel.getByText('Userinfo Antwort JSON').click()
  await expect(userInfoPanel.getByRole('textbox')).toContainText(userId)
  await introspectionPanel.getByText('Introspection Antwort JSON').click()
  await expect(introspectionPanel.getByRole('textbox')).toContainText('active')
  await page.getByText('Dekodierte Token-Details').click()
  const claimSummary = page.getByLabel('Token claim summary')
  const comparisonClaimsTable = page.getByRole('table', { name: 'Access- und ID-Token Claims' })
  await expect(claimSummary).toBeVisible()
  await expect(comparisonClaimsTable).toBeVisible()
  await expect(comparisonClaimsTable.getByRole('row', { name: /exp/i })).toContainText('Unix')
  await expect(page.locator('summary').filter({ hasText: /Token JWT/ })).toHaveCount(3)
  await expect(comparisonClaimsTable.getByRole('row', { name: /email_verified/i })).toContainText('false')
  await expect(claimSummary.locator('article').filter({ hasText: 'Benutzer-ID' }).locator('strong')).toHaveText(userId)
  await expect(claimSummary.locator('article').filter({ hasText: 'Benutzername' }).locator('strong')).toHaveText(userId)
  await expect(claimSummary.locator('article').filter({ hasText: 'Sitzungs-ID' }).locator('strong')).not.toBeEmpty()
  await expect(claimSummary.locator('article').filter({ hasText: 'Rollen' }).locator('strong')).not.toBeEmpty()
  await expect(claimSummary.locator('article').filter({ hasText: 'Endet' }).locator('strong')).not.toBeEmpty()

  await expect(page.getByText('OIDC-geschützte Demo-Endpunkte')).toHaveCount(0)
  const mockApiPanel = page.getByLabel('Protected mock API panel')
  await expect(mockApiPanel).toHaveCount(0)
  await page.getByRole('tab', { name: 'Mock API Demo API' }).click()
  await expect(page.getByRole('tab', { name: 'Mock API Demo API' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Token Sitzung' })).toHaveAttribute('aria-selected', 'false')
  await expect(mockApiPanel).toContainText('mock-api')
  await expect(mockApiPanel).toContainText(userId)
  await expect(mockApiPanel).toContainText('JWKS')
  await expect(page.getByRole('button', { name: 'Mock API neu laden' })).toBeVisible()
  await expect(page.getByText('OIDC-geschützte Demo-Endpunkte')).toBeVisible()
  await page.getByLabel('Neue geschützte Notiz').fill('Playwright protected note')
  await page.getByRole('button', { name: 'Notiz an Mock API senden' }).click()
  await expect(mockApiPanel).toContainText('Playwright protected note')
  await waitForTrace(request, userId, 'mock_api_message_create_finished', 'mock-api')

  await page.getByRole('tab', { name: 'Token Sitzung' }).click()
  await expect(page.getByRole('heading', { name: 'Access- und ID-Token' })).toBeVisible()
  await page.getByRole('button', { name: 'Tokens aktualisieren' }).click()
  await expect(page.getByRole('heading', { name: 'Access- und ID-Token' })).toBeVisible()

  await page.getByRole('tab', { name: 'Mock API Demo API' }).click()
  await expect(mockApiPanel).toContainText('mock-api')

  await page.getByRole('tab', { name: 'Token Sitzung' }).click()
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Dieses Telefon ist bereit' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mit Gerät fortfahren' })).toBeVisible()
  await expect(page.getByText('Noch keine Keycloak-Tokens.')).toBeVisible()

  await page.getByRole('button', { name: 'Gerätebindung entfernen' }).click()
  await expect(page.getByText('Gerätebindung von diesem Gerät entfernt')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Weiter' })).toBeVisible()
  await expect(bindingNotice).toHaveCount(0)

  const loginTrace = await waitForUserLoginTrace(request, userId)

  await page.goto(TRACE_WEB_URL)
  await expect(page.getByRole('heading', { name: /behalte den ausgewaehlten trace im blick und öffne die detailinspektion/i })).toBeVisible()
  await expect(page.getByText(/im demo-modus werden alle payloads erfasst/i)).toBeVisible()

  const traceList = page.getByRole('list', { name: 'Trace list' })
  await expect(traceList).toContainText(/device_login_finish|device_login_finished/i)
  await expect(traceList).toBeVisible()

  await page.goto(`${TRACE_WEB_URL}#trace/${loginTrace.traceId}`)
  await expect(page).toHaveURL(`${TRACE_WEB_URL}#trace/${loginTrace.traceId}`)
  await expect(page.getByRole('heading', { name: 'Detailinspektion' })).toBeVisible()
  await expect(page.getByText('Span- und Artefaktdetails')).toBeVisible()
  await expect(page.getByText(/Diese Seite zeigt Requests und Responses je Span/i)).toBeVisible()
  await expect(page.locator('[aria-label="Trace Zusatzmetadaten"]').first()).toContainText(loginTrace.traceId)
  await expect(page.locator('[aria-label="Trace Zusatzmetadaten"]').first()).toContainText(userId)

  const timeline = page.getByRole('list', { name: 'Trace spans timeline' })
  await expect(timeline).toContainText('auth-api')
  await expect(timeline).toContainText('keycloak')
  await expect(timeline).toContainText('web-client')
  await expect(timeline.getByText(/\d{2}\.\d{2}\.\d{4}.*UTC/i).first()).toBeVisible()

  const artifactList = page.getByRole('list', { name: 'Artifact list' })
  await timeline.getByRole('button', { name: /auth-api start_login/i }).click()
  await expect(artifactList).toContainText('encrypted_challenge')
  await artifactList.getByRole('button', { name: /encrypted_challenge/i }).click()

  const artifactViewer = page.getByLabel('Artifact viewer')
  await expect(artifactViewer).toBeVisible({ timeout: 10000 })
  const challengeArtifactBlocks = artifactViewer.locator('.artifact-block')
  await expect(challengeArtifactBlocks).toHaveCount(4)
  await expect(challengeArtifactBlocks.nth(0)).toContainText(/"exp": "\d{10} \/\* .* UTC \*\/"/)
  await expect(challengeArtifactBlocks.nth(1)).toContainText(/"exp": "\d{10} \/\* .* UTC \*\/"/)
  await expect(challengeArtifactBlocks.nth(2)).toContainText(/"exp": "\d{10} \/\* .* UTC \*\/"/)

  await timeline.getByRole('button', { name: /keycloak/i }).first().click()

  await expect(artifactList).toContainText('id_token')
  await artifactList.getByRole('button', { name: /id_token/i }).click()

  await expect(artifactViewer).toBeVisible({ timeout: 10000 })
  await expect(artifactViewer).toContainText('Decodiert')
  await expect(artifactViewer).toContainText('Erläutert')
  await expect(artifactViewer).toContainText('Subject')
  await expect(artifactViewer).toContainText('Audience')
})

test('missing saved device binding is cleared instead of failing with a server error', async ({ page, request }) => {
  const userId = `e2e-missing-device-${Date.now()}`
  const deviceName = 'Missing Device Test'
  const registrationResponse = await request.post(`${AUTH_API_URL}/api/admin/registration-codes`, {
    data: {
      userId,
      displayName: 'Missing Device User',
      validForDays: 30
    }
  })

  expect(registrationResponse.ok()).toBeTruthy()
  const registration = await registrationResponse.json()

  await page.goto('https://app.localhost:8443')
  await page.getByLabel('Benutzer-ID').fill(userId)
  await page.getByLabel('Gerätename').fill(deviceName)
  await page.getByLabel('Aktivierungscode').fill(registration.code)
  await page.getByRole('button', { name: 'Weiter' }).click()

  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()

  await expect(page.getByRole('heading', { name: 'Neues Passwort erstellen' })).toBeVisible()
  await page.getByLabel('Neues Passwort').fill('ChangeMe123!')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()

  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()
  await expect(page.getByRole('heading', { name: deviceName })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Mit gespeichertem Gerät anmelden' })).toBeVisible()

  const devicesResponse = await request.get(`${AUTH_API_URL}/api/admin/devices`)
  expect(devicesResponse.ok()).toBeTruthy()
  const devices = await devicesResponse.json() as Array<{ id: string; userId: string; deviceName: string }>
  const device = devices.find((item) => item.userId === userId && item.deviceName === deviceName)

  expect(device).toBeTruthy()

  const deleteResponse = await request.delete(`${AUTH_API_URL}/api/admin/devices/${device?.id}`)
  expect(deleteResponse.status()).toBe(204)

  await page.getByRole('button', { name: 'Mit Gerät fortfahren' }).click()
  await expect(page.getByText('Gespeicherte Gerätebindung war ungültig und wurde entfernt')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dieses Telefon einrichten' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Geräteanmeldung einrichten' })).toBeVisible()

  const storedBinding = await page.evaluate(() => window.localStorage.getItem('auth-sandbox-2.device-binding'))
  expect(storedBinding).toBeNull()
})

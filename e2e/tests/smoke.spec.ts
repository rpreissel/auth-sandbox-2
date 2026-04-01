import { createHash, generateKeyPairSync, sign } from 'node:crypto'

import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import type { SmsTanStartResponse } from '@auth-sandbox-2/shared-types'

const AUTH_API_URL = 'https://auth.localhost:8443'
const SERVICEMOCK_API_URL = 'https://webmock.localhost:8443'
const TRACE_API_URL = 'https://trace.localhost:8443'
const KEYCLOAK_METADATA_URL = 'https://keycloak.localhost:8443/realms/auth-sandbox-2/.well-known/openid-configuration'
const KEYCLOAK_TOKEN_URL = 'https://keycloak.localhost:8443/realms/auth-sandbox-2/protocol/openid-connect/token'
const DB_VIEWER_URL = 'https://db.localhost:8443'
const ADMIN_WEB_URL = 'https://admin.localhost:8443'
const TRACE_WEB_URL = 'https://trace.localhost:8443/'
const MOCK_WEB_URL = 'https://webmock.localhost:8443'
const ADMIN_PROXY_HEADERS = { authorization: 'Bearer change-me-admin-proxy-token' }
const APP_PROXY_HEADERS = { authorization: 'Bearer change-me-app-proxy-token' }
const TRACE_BROWSER_HEADERS = { authorization: 'Bearer change-me-trace-browser-token' }

type TraceListItem = {
  traceId: string
  traceType: string
  actors: string[]
}

function createSigningKeys() {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyHash: createHash('sha256').update(pair.publicKey).digest('hex')
  }
}

function signEncryptedData(encryptedData: string, privateKeyPem: string) {
  return sign('RSA-SHA256', Buffer.from(encryptedData, 'base64'), privateKeyPem).toString('base64')
}

async function waitForRuntimeReady(request: APIRequestContext) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const [healthResponse, mockHealthResponse, traceHealthResponse, metadataResponse] = await Promise.all([
      request.get(`${AUTH_API_URL}/api/health`),
      request.get(`${SERVICEMOCK_API_URL}/health`),
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
  return waitForTrace(request, userId, 'device_login_finish', 'appmock-web')
}

async function waitForTrace(request: APIRequestContext, userId: string, traceType: string, actor: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const params = new URLSearchParams({
      userId,
      page: '1',
      pageSize: '20'
    })
    const response = await request.get(`${TRACE_API_URL}/traces?${params.toString()}`, {
      headers: TRACE_BROWSER_HEADERS
    })

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

async function createBrowserUser(request: APIRequestContext, suffix: string) {
  const userId = `webmock-web-${suffix}-${Date.now()}`
  const password = 'ChangeMe123!'
  const response = await request.post(`${AUTH_API_URL}/api/admin/registration-identities`, {
    headers: ADMIN_PROXY_HEADERS,
    data: {
      userId,
      firstName: 'Mock',
      lastName: 'Browser',
      birthDate: '1990-01-01',
      phoneNumber: '+491701234567'
    }
  })

  expect(response.ok()).toBeTruthy()

  const passwordResponse = await request.post(`${AUTH_API_URL}/api/device/set-password`, {
    headers: APP_PROXY_HEADERS,
    data: {
      userId,
      password
    }
  })

  expect(passwordResponse.ok()).toBeTruthy()
  return { userId, password }
}

async function loginWebMockWeb(page: import('@playwright/test').Page, userId: string, password: string) {
  await page.context().clearCookies()
  await page.goto(MOCK_WEB_URL)
  await expect(page.getByRole('button', { name: /mit keycloak 1se anmelden/i })).toBeVisible()
  await page.getByRole('button', { name: /mit keycloak 1se anmelden/i }).click()

  await expect(page).toHaveURL(/keycloak\.localhost:8443/)
  await page.locator('#username').fill(userId)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /sign in|anmelden/i }).click()

  await expect(page).toHaveURL(/mock\.localhost:8443/)
  const tokenSessionCard = page.locator('.card').filter({ has: page.getByRole('heading', { name: /token claims and browser session/i }) })
  await expect(tokenSessionCard).toContainText('Has token')
  await expect(tokenSessionCard).toContainText('yes', { timeout: 15000 })
}

async function getInternalRedeemAccessToken(request: APIRequestContext) {
  const response = await request.post(KEYCLOAK_TOKEN_URL, {
    form: {
      grant_type: 'client_credentials',
      client_id: 'auth-api-internal-redeem',
      client_secret: 'change-me-internal-redeem'
    }
  })

  expect(response.ok()).toBeTruthy()
  const body = await response.json() as { access_token: string }
  return body.access_token
}

async function loginWithDevice(request: APIRequestContext, input: { publicKeyHash: string; privateKey: string }) {
  const startLoginResponse = await request.post(`${AUTH_API_URL}/api/device/login/start`, {
    data: {
      publicKeyHash: input.publicKeyHash
    }
  })

  expect(startLoginResponse.ok()).toBeTruthy()
  const challenge = await startLoginResponse.json() as {
    nonce: string
    encryptedKey: string
    encryptedData: string
    iv: string
  }

  const finishLoginResponse = await request.post(`${AUTH_API_URL}/api/device/login/finish`, {
    data: {
      nonce: challenge.nonce,
      encryptedKey: challenge.encryptedKey,
      encryptedData: challenge.encryptedData,
      iv: challenge.iv,
      signature: signEncryptedData(challenge.encryptedData, input.privateKey)
    }
  })

  expect(finishLoginResponse.ok()).toBeTruthy()
  return finishLoginResponse.json() as Promise<{ accessToken: string; refreshToken: string }>
}

test.beforeEach(async ({ request }) => {
  await waitForRuntimeReady(request)
})

test('shared postgres runtime exposes auth, trace, and keycloak endpoints', async ({ request }) => {
  const [healthResponse, mockHealthResponse, traceHealthResponse, metadataResponse] = await Promise.all([
    request.get(`${AUTH_API_URL}/api/health`),
    request.get(`${SERVICEMOCK_API_URL}/health`),
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

  await expect(page.getByRole('heading', { name: /bereite registrierungsidentitaeten vor und behalte bestehende geraetebindungen im blick/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /springe vom admin-ueberblick direkt in die trace-analyse/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Registrierungsidentität vorbereiten' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Geraete', exact: true })).toBeVisible()
  await expect(page.getByLabel('Admin Ueberblickszahlen')).toContainText('Geraete')
  await expect(page.getByLabel('Geraete durchsuchen')).toBeVisible()
  const traceViewerLink = page.getByRole('link', { name: 'Trace Viewer oeffnen' })
  await expect(traceViewerLink).toBeVisible()
  await expect(traceViewerLink).toHaveAttribute('href', 'https://trace.localhost:8443/')
  await expect(traceViewerLink).toHaveAttribute('target', '_blank')
})

test('admin overview shows save errors instead of opaque network failures', async ({ page }) => {
  await page.goto(ADMIN_WEB_URL)

  await page.locator('input[name="userId"]').fill(`admin-error-${Date.now()}`)
  await page.locator('input[name="codeValidForDays"]').fill('0')
  await page.getByRole('button', { name: 'Identität speichern' }).click()

  await expect(page.getByRole('alert')).toContainText('Too small')
})

test('homepage contains key links', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /minimal device-login sandbox/i })).toBeVisible()
  const appMockWebLink = page.getByRole('link', { name: /appmock web/i })
  const webMockWebLink = page.getByRole('link', { name: /webmock web/i })
  const dbViewerLink = page.getByRole('link', { name: /db viewer/i })
  await expect(appMockWebLink).toBeVisible()
  await expect(webMockWebLink).toBeVisible()
  await expect(dbViewerLink).toBeVisible()
  await expect(appMockWebLink).toHaveAttribute('target', '_blank')
  await expect(webMockWebLink).toHaveAttribute('target', '_blank')
  await expect(dbViewerLink).toHaveAttribute('target', '_blank')
  await expect(page.getByRole('heading', { name: /db viewer login/i })).toBeVisible()
  await expect(page.getByText('auth_sandbox_2')).toBeVisible()
  await expect(page.getByText('auth_api, keycloak')).toBeVisible()
  await expect(page.getByRole('heading', { name: /sequence diagrams/i })).toBeVisible()
  await expect(page.getByText('Admin provisioning and registration identity')).toBeVisible()
  await expect(page.getByText('Device registration and password bootstrap')).toBeVisible()
  await expect(page.getByText('Encrypted device login and protected API use')).toBeVisible()
  await expect(page.getByText('Refresh and logout lifecycle')).toBeVisible()
  await expect(page.getByText('Browser login and inline 2se step-up')).toBeVisible()
  const passwordBootstrapCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Device registration and password bootstrap' }) })
  await expect(passwordBootstrapCard).toContainText(/backend password setup/i)
  await expect(page.getByLabel('Browser login and inline 2se step-up actors')).toContainText('KC Extension')
  await expect(page.getByLabel('Device registration and password bootstrap mermaid sequence diagram')).toBeVisible()
  await expect(page.getByLabel('Refresh and logout lifecycle mermaid sequence diagram')).toBeVisible()
})

test('webmock web homepage serves the browser step-up app shell', async ({ page }) => {
  await page.goto('https://webmock.localhost:8443')
  await expect(page.getByRole('heading', { name: /browser login starts with 1se/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /mit keycloak 1se anmelden/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /step-up auf 2se starten/i })).toBeVisible()
  await expect(page.getByText(/trigger a fresh auth request with/i)).toBeVisible()
})

test('webmock web browser login, step-up, and tracing work end to end', async ({ page, request }) => {
  test.setTimeout(90000)
  const statusCards = page.getByLabel('WebMock status cards')
  const currentAcrCard = statusCards.locator('article').filter({ hasText: 'Current acr' })

  const { userId, password } = await createBrowserUser(request, 'stepup')
  await loginWebMockWeb(page, userId, password)

  await expect(statusCards).toBeVisible()
  await expect(currentAcrCard.locator('strong')).toHaveText('1se')
  await expect(page.getByText(/step-up to 2se to unlock this endpoint/i)).toBeVisible()

  await page.getByRole('button', { name: /step-up auf 2se starten/i }).click()
  await expect(page).toHaveURL(/keycloak\.localhost:8443/)
  await expect(page.getByText(/sms-tan bestaetigen|sms-tan bestätigen/i)).toBeVisible()
  const demoTanText = await page.locator('body').textContent()
  const demoTan = demoTanText?.match(/Demo TAN:\s*(\d{6})/)?.[1]
  expect(demoTan).toBeTruthy()
  await page.locator('#smsTan').fill(demoTan ?? '')
  await page.getByRole('button', { name: /2se schritt abschliessen|2se Schritt abschließen/i }).click()

  await expect(page).toHaveURL(/webmock\.localhost:8443/)
  await expect(currentAcrCard.locator('strong')).toHaveText('2se', { timeout: 15000 })
  await expect(page.getByText(/the token satisfied the stronger 2se assurance check/i)).toBeVisible()

  await page.getByLabel('Neue geschützte Notiz').fill('WebMock Web playwright note')
  await page.getByRole('button', { name: /notiz an servicemock api senden/i }).click()
  await expect(page.getByLabel('WebMock message response')).toContainText('WebMock Web playwright note')

  const browserTrace = await waitForTrace(request, userId, 'webmock_web_step_up', 'webmock-web')
  const internalStepUpTrace = await waitForTrace(request, userId, 'browser_step_up_complete_internal', 'keycloak-extension')
  await page.goto(`${TRACE_WEB_URL}#trace/${browserTrace.traceId}`)
  await expect(page.getByRole('heading', { name: 'Detailinspektion' })).toBeVisible()

  const timeline = page.getByRole('list', { name: 'Trace spans timeline' })
  await expect(timeline).toContainText('webmock-web')
  const proxyLogList = page.getByRole('list', { name: 'Proxy log list' })
  await expect(proxyLogList).toContainText('keycloak.localhost')
  await expect(proxyLogList).toContainText('/protocol/openid-connect/auth?')

  const artifactList = page.getByRole('list', { name: 'Artifact list' })
  await timeline.getByRole('button', { name: /webmock_web_step_up_challenge_ready/i }).click()
  await expect(page.getByRole('tab', { name: /sms_tan_challenge event_payload/i })).toBeVisible()
  await page.getByRole('tab', { name: /sms_tan_challenge event_payload/i }).click()
  const artifactViewer = page.getByLabel('Artifact viewer')
  await expect(artifactViewer).toContainText('keycloak_inline')

  await page.goto(`${TRACE_WEB_URL}#trace/${internalStepUpTrace.traceId}`)
  await expect(page.getByRole('heading', { name: 'Detailinspektion' })).toBeVisible()
  const authApiTimeline = page.getByRole('list', { name: 'Trace spans timeline' })
  await expect(authApiTimeline).toContainText('auth-api')
  await expect(authApiTimeline).toContainText('keycloak-extension')
  await authApiTimeline.getByRole('button', { name: /POST \/api\/internal\/browser-step-up\/start/i }).click()
  await expect(page.getByRole('tab', { name: /outgoing_response_body response_body/i })).toBeVisible()
  await page.getByRole('tab', { name: /outgoing_response_body response_body/i }).click()
  await expect(artifactViewer).toContainText('maskedTarget')
})

test('appmock can open webmock through bootstrap SSO', async ({ page, context, request }) => {
  test.setTimeout(90000)

  const userId = `e2e-sso-${Date.now()}`
  const registrationResponse = await request.post(`${AUTH_API_URL}/api/admin/registration-identities`, {
    headers: ADMIN_PROXY_HEADERS,
    data: {
      userId,
      firstName: 'SSO',
      lastName: 'User',
      birthDate: '1990-01-01',
      phoneNumber: '+491701234567'
    }
  })

  expect(registrationResponse.ok()).toBeTruthy()

  await page.goto('https://appmock.localhost:8443')
  await page.getByLabel('Benutzer-ID').fill(userId)
  await page.getByLabel('Vorname').fill('SSO')
  await page.getByLabel('Nachname').fill('User')
  await page.getByLabel('Geburtsdatum').fill('1990-01-01')
  await page.getByLabel('Telefonnummer').fill('+491701234567')
  await page.getByLabel('Gerätename').fill('Playwright SSO Device')
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()

  const startSmsTanResponsePromise = page.waitForResponse((response) => response.url().includes('/api/identification/sms-tan/start') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'SMS-TAN senden', exact: true }).click()
  const startSmsTanResponse = await startSmsTanResponsePromise
  const startSmsTanBody = await startSmsTanResponse.json() as SmsTanStartResponse
  await page.getByRole('textbox', { name: 'SMS-TAN' }).fill(startSmsTanBody.devCode ?? '')
  await page.getByRole('button', { name: 'SMS-TAN bestätigen' }).click()

  await page.getByLabel('Neues Passwort').fill('ChangeMe123!')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()

  await expect(page.getByText('Angemeldet mit aktiver Sitzung')).toBeVisible({ timeout: 20000 })
  const prepareWebmockSsoButton = page.locator('button').filter({ hasText: 'WebMock SSO vorbereiten' }).first()
  await expect(prepareWebmockSsoButton).toBeVisible({ timeout: 20000 })

  const securePrompt = page.getByRole('region', { name: 'Secure element prompt' })
  if (await securePrompt.isVisible().catch(() => false)) {
    await securePrompt.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(securePrompt).toHaveCount(0)
  }

  await expect(page.getByRole('note', { name: 'SSO launch result' })).toHaveCount(0)

  const newPagePromise = context.waitForEvent('page')
  await prepareWebmockSsoButton.click({ force: true })
  const ssoLaunchNote = page.getByRole('note', { name: 'SSO launch result' })
  await expect(ssoLaunchNote).toContainText('Angeforderte Assurance: 2se')
  await expect(ssoLaunchNote).toContainText('SSO-Start: https://keycloak.localhost:8443/')
  await expect(ssoLaunchNote).toContainText('https://webmock.localhost:8443/')
  await expect(page.getByRole('button', { name: 'SSO-URL kopieren' })).toBeVisible()
  await page.getByRole('button', { name: 'Vorbereiteten SSO-Tab öffnen' }).click()
  const webmockPage = await newPagePromise
  await webmockPage.waitForLoadState('networkidle')

  await expect(webmockPage).toHaveURL(/webmock\.localhost:8443|auth\.localhost:8443\/api\/sso-bootstrap\/callback|keycloak\.localhost:8443/)

  const currentUrl = webmockPage.url()
  expect(currentUrl).not.toContain('/protocol/openid-connect/auth?client_id=sso-bootstrap-web&request_uri=')

  if (currentUrl.includes('webmock.localhost:8443')) {
    const webmockStatusCards = webmockPage.getByLabel('WebMock status cards')
    const currentAcrCard = webmockStatusCards.locator('article').filter({ hasText: 'Current acr' })
    const tokenSessionCard = webmockPage.locator('.card').filter({ has: webmockPage.getByRole('heading', { name: /token claims and browser session/i }) })

    await expect(
      webmockPage.getByRole('heading', { name: /Browser login starts with 1se|Token claims and browser session/i }).first()
    ).toBeVisible()
    await expect(currentAcrCard.locator('strong')).toHaveText('none', { timeout: 15000 })
    await expect(webmockPage.getByRole('button', { name: /mit keycloak 1se anmelden/i })).toBeVisible()

    await webmockPage.getByRole('button', { name: /mit keycloak 1se anmelden/i }).click()
    await webmockPage.waitForLoadState('networkidle')
    await expect(webmockPage).toHaveURL(/keycloak\.localhost:8443|webmock\.localhost:8443/)
    expect(webmockPage.url()).not.toContain('request_uri=')
    await expect(webmockPage.getByText('Sign in to your account')).toHaveCount(0)
    await expect(currentAcrCard.locator('strong')).toHaveText('1se', { timeout: 15000 })
    await expect(tokenSessionCard).toContainText('Has token')
    await expect(tokenSessionCard).toContainText('yes', { timeout: 15000 })

    await expect(webmockPage.getByText(/step-up to 2se to unlock this endpoint/i)).toBeVisible()
    await webmockPage.getByRole('button', { name: /step-up auf 2se starten/i }).click()
    await webmockPage.waitForLoadState('networkidle')
    await expect(webmockPage.getByText('Sign in to your account')).toHaveCount(0)
    await expect(currentAcrCard.locator('strong')).toHaveText('2se', { timeout: 15000 })
  }

  const ssoTrace = await waitForTrace(request, userId, 'sso_launch_finished', 'appmock-web')
  await page.goto(`${TRACE_WEB_URL}#trace/${ssoTrace.traceId}`)
  await expect(page).toHaveURL(`${TRACE_WEB_URL}#trace/${ssoTrace.traceId}`)
  await expect(page.getByRole('heading', { name: 'Detailinspektion' })).toBeVisible()

  const ssoTimeline = page.getByRole('list', { name: 'Trace spans timeline' })
  await expect(ssoTimeline).toContainText('appmock-web')
  await expect(ssoTimeline).toContainText('auth-api')

  const proxyLogList = page.getByRole('list', { name: 'Proxy log list' })
  await expect(proxyLogList).toContainText('keycloak.localhost')
  await expect(proxyLogList).toContainText('/protocol/openid-connect/auth?client_id=sso-bootstrap-web')
})

test('device login flow supports tokens refresh and logout', async ({ page, request }) => {
  test.setTimeout(45000)
  const userId = `e2e-user-${Date.now()}`
  const registrationResponse = await request.post(`${AUTH_API_URL}/api/admin/registration-identities`, {
    headers: ADMIN_PROXY_HEADERS,
    data: {
      userId,
      firstName: 'E2E',
      lastName: 'User',
      birthDate: '1990-01-01',
      phoneNumber: '+491701234567'
    }
  })

  expect(registrationResponse.ok()).toBeTruthy()

  await page.goto('https://appmock.localhost:8443')
  await expect(page.getByRole('heading', { name: 'Dieses Telefon einrichten' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Geräteanmeldung einrichten' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sitzungstokens', exact: true })).toBeVisible()
  await expect(page.getByLabel('Token wallet empty state')).toContainText('Tokens erscheinen erst nach erfolgreicher Geräteanmeldung.')
  await page.getByLabel('Benutzer-ID').fill(userId)
  await page.getByLabel('Vorname').fill('E2E')
  await page.getByLabel('Nachname').fill('User')
  await page.getByLabel('Geburtsdatum').fill('1990-01-01')
  await page.getByLabel('Telefonnummer').fill('+491701234567')
  await page.getByLabel('Gerätename').fill('Playwright Device')
  await expect(page.getByLabel('Nächster Schritt')).toHaveValue('Service wird nach dem Erstellen des Flows gewählt')
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await expect(page.getByText('Bestätige deine Identität')).toBeVisible()
  await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()
  await expect(page.getByRole('heading', { name: 'Verfügbaren Service ausführen' })).toBeVisible()
  await expect(page.getByText('SMS-TAN erscheint nur mit hinterlegter Telefonnummer.')).toBeVisible()
  const startSmsTanResponsePromise = page.waitForResponse((response) => response.url().includes('/api/identification/sms-tan/start') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'SMS-TAN senden', exact: true }).click()
  const startSmsTanResponse = await startSmsTanResponsePromise
  expect(startSmsTanResponse.ok()).toBeTruthy()
  const startSmsTanBody = await startSmsTanResponse.json() as SmsTanStartResponse
  expect(startSmsTanBody.devCode).toMatch(/^\d{6}$/)
  await expect(page.getByText(`SMS-TAN fuer die Demo: ${startSmsTanBody.devCode ?? ''}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Neue SMS-TAN senden' })).toBeVisible()
  await page.getByRole('textbox', { name: 'SMS-TAN' }).fill(startSmsTanBody.devCode ?? '')
  await page.getByRole('button', { name: 'SMS-TAN bestätigen' }).click()

  await expect(page.getByText('Gerätebindung gespeichert. Lege ein neues Keycloak-Passwort fest, um fortzufahren.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Neues Passwort erstellen' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Passwort speichern' })).toBeVisible()

  await page.getByLabel('Neues Passwort').fill('ChangeMe123!')
  await page.getByRole('button', { name: 'Passwort speichern' }).click()

  const authenticatedTokenSummary = page.getByLabel('Authenticated token summary')
  const postPasswordPrompt = page.getByLabel('Secure element prompt')
  const postPasswordState = await Promise.race([
    authenticatedTokenSummary.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'authenticated'),
    postPasswordPrompt.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'prompt')
  ])
  if (postPasswordState === 'prompt') {
    await postPasswordPrompt.getByRole('button', { name: 'Displaysperre verwenden' }).click()
  }

  await expect(authenticatedTokenSummary).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Angemeldet mit aktiver Sitzung')).toBeVisible()
  await expect(page.getByLabel('Session token section')).toBeVisible()
  await expect(page.getByText('Zugriff')).toBeVisible()
  await expect(page.getByText('Access-Token bereit')).toBeVisible()
  await expect(page.getByLabel('Token claim summary').locator('article').filter({ hasText: 'Assurance Level' }).locator('strong')).toHaveText('2se')
  const bindingNotice = page.getByRole('note', { name: 'Local device binding notice' })
  if (await postPasswordPrompt.isVisible().catch(() => false)) {
    await postPasswordPrompt.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(postPasswordPrompt).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: 'Tokens aktualisieren' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Gerät bereit' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Geräteanmeldung starten' })).toBeVisible()
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

  await expect(authenticatedTokenSummary).toBeVisible({ timeout: 15000 })
  await expect(page.getByLabel('Session token section')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Token Sitzung' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'ServiceMock API Demo API' })).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByLabel('Token claim summary')).toBeVisible()
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
  await expect(claimSummary.locator('article').filter({ hasText: 'Assurance Level' }).locator('strong')).toHaveText('2se')
  await expect(claimSummary.locator('article').filter({ hasText: 'Endet' }).locator('strong')).not.toBeEmpty()
  await expect(comparisonClaimsTable.getByRole('row', { name: /acr/i })).toContainText('2se')

  await expect(page.getByText('OIDC-geschützte Demo-Endpunkte')).toHaveCount(0)
  const serviceMockApiPanel = page.getByLabel('Protected mock API panel')
  await expect(serviceMockApiPanel).toHaveCount(0)
  await page.getByRole('tab', { name: 'ServiceMock API Demo API' }).click()
  await expect(page.getByRole('tab', { name: 'ServiceMock API Demo API' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Token Sitzung' })).toHaveAttribute('aria-selected', 'false')
  await expect(serviceMockApiPanel).toContainText('servicemock-api')
  await expect(serviceMockApiPanel).toContainText(userId)
  await expect(serviceMockApiPanel).toContainText('JWKS')
  await expect(page.getByRole('button', { name: 'ServiceMock API neu laden' })).toBeVisible()
  await expect(page.getByText('OIDC-geschützte Demo-Endpunkte')).toBeVisible()
  await page.getByLabel('Neue geschützte Notiz').fill('Playwright protected note')
  await page.getByRole('button', { name: 'Notiz an ServiceMock API senden' }).click()
  await expect(serviceMockApiPanel).toContainText('Playwright protected note')
  await waitForTrace(request, userId, 'servicemock_api_message_create_finished', 'servicemock-api')

  await page.getByRole('tab', { name: 'Token Sitzung' }).click()
  await expect(page.getByLabel('Session token section')).toBeVisible()
  await page.getByRole('button', { name: 'Tokens aktualisieren' }).click()
  await expect(page.getByLabel('Session token section')).toBeVisible()

  await page.getByRole('tab', { name: 'ServiceMock API Demo API' }).click()
  await expect(serviceMockApiPanel).toContainText('servicemock-api')

  await page.getByRole('tab', { name: 'Token Sitzung' }).click()
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await expect(page.getByRole('heading', { name: 'Gerät bereit' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mit Gerät fortfahren' })).toBeVisible()
  await expect(page.getByRole('note', { name: 'Local device binding notice' })).toContainText('Tokens werden aber erst nach einer erfolgreichen Geräteanmeldung ausgestellt.')

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
  await expect(timeline).toContainText('appmock-web')
  await expect(timeline.getByText(/\d{2}\.\d{2}\.\d{4}.*UTC/i).first()).toBeVisible()

  await timeline.getByRole('button', { name: /auth-api start_login/i }).click()
  const artifactTabs = page.getByRole('tablist', { name: 'Artifact quick access' })
  await expect(artifactTabs).toContainText('encrypted_challenge')
  await artifactTabs.getByRole('tab', { name: /encrypted_challenge/i }).click()

  const artifactViewer = page.getByLabel('Artifact viewer')
  await expect(artifactViewer).toBeVisible({ timeout: 10000 })
  await expect(artifactViewer).toContainText('Rohdaten')
  await expect(artifactViewer).toContainText('Entschluesselt')
  await expect(artifactViewer).toContainText('UTC */')
  await expect(artifactViewer.locator('textarea').first()).toBeVisible()

  await timeline.getByRole('button', { name: /keycloak/i }).first().click()

  await expect(artifactTabs).toContainText('id_token')
  await artifactTabs.getByRole('tab', { name: /id_token/i }).click()

  await expect(artifactViewer).toBeVisible({ timeout: 10000 })
  await expect(artifactViewer).toContainText('Decodiert')
  await expect(artifactViewer).toContainText('Erläutert')
  await expect(artifactViewer).toContainText('Subject')
  await expect(artifactViewer).toContainText('Audience')

  await timeline.getByRole('button', { name: /keycloak POST \/realms\/auth-sandbox-2\/protocol\/openid-connect\/token/i }).first().click()
  await expect(artifactTabs).toContainText('request_body')

  await artifactTabs.getByRole('tab', { name: /^request_body/i }).click()
  await expect(artifactViewer).toContainText('form.login_token')
  await expect(artifactViewer).toContainText(userId)

  await artifactTabs.getByRole('tab', { name: /^request_headers/i }).click()
  await expect(artifactViewer).toContainText('headers.x-trace-id')

  await artifactTabs.getByRole('tab', { name: /^response_body/i }).click()
  await expect(artifactViewer).toContainText('body.access_token')
  await expect(artifactViewer.locator('textarea').first()).toBeVisible()
  await expect(artifactViewer).toContainText('Verschachtelt decodiert: body.access_token')

  await artifactTabs.getByRole('tab', { name: /^response_headers/i }).click()
  await expect(artifactViewer).toContainText('headers.content-type')
})

test('registration and step-up flow APIs support service selection, concrete service lifecycle, finalize, and redeem', async ({ page, request }) => {
  const userId = `e2e-flow-${Date.now()}`
  const registrationCode = `FLOW${Date.now().toString(36).toUpperCase()}`
  const signingKeys = createSigningKeys()
  const withBearer = (token: string) => ({
    authorization: `Bearer ${token}`
  })

  const registrationIdentityResponse = await request.post(`${AUTH_API_URL}/api/admin/registration-identities`, {
    headers: ADMIN_PROXY_HEADERS,
    data: {
      userId,
      firstName: 'Flow',
      lastName: 'User',
      birthDate: '1990-01-01',
      code: registrationCode,
      codeValidForDays: 30,
      phoneNumber: '+49123456789'
    }
  })

  expect(registrationIdentityResponse.ok()).toBeTruthy()

  const createRegistrationFlow = await request.post(`${AUTH_API_URL}/api/registration-flows`, {
    data: {
      requiredAcr: 'level_1',
      userId,
      firstName: 'Flow',
      lastName: 'User',
      birthDate: '1990-01-01',
      deviceName: 'Flow Device',
      publicKey: signingKeys.publicKey
    }
  })

  expect(createRegistrationFlow.status()).toBe(201)
  const registrationFlow = await createRegistrationFlow.json() as { flowId: string; flowToken: string; nextAction: string; status: string; availableServices: Array<{ id: string }> }
  expect(registrationFlow.status).toBe('started')
  expect(registrationFlow.nextAction).toBe('select_service')
  expect(registrationFlow.availableServices.map((service) => service.id).sort()).toEqual(['person_code', 'sms_tan'])

  const missingTokenGet = await request.get(`${AUTH_API_URL}/api/flows/${registrationFlow.flowId}`)
  expect(missingTokenGet.status()).toBe(401)

  const selectCode = await request.post(`${AUTH_API_URL}/api/flows/${registrationFlow.flowId}/select-service`, {
    headers: withBearer(registrationFlow.flowToken),
    data: {
      service: 'person_code'
    }
  })
  expect(selectCode.ok()).toBeTruthy()
  const selectedCode = await selectCode.json() as { serviceToken: string; selectedService: string; nextAction: string }
  expect(selectedCode.selectedService).toBe('person_code')
  expect(selectedCode.nextAction).toBe('use_service')

  const completeCode = await request.post(`${AUTH_API_URL}/api/identification/person-code/complete`, {
    headers: withBearer(selectedCode.serviceToken),
    data: {
      code: registrationCode
    }
  })
  expect(completeCode.ok()).toBeTruthy()
  const completedCode = await completeCode.json() as { status: string; serviceResultToken: string; achievedAcr: string }
  expect(completedCode.status).toBe('verified')
  expect(completedCode.achievedAcr).toBe('level_2')

  const finalizeRegistration = await request.post(`${AUTH_API_URL}/api/flows/${registrationFlow.flowId}/finalize`, {
    headers: withBearer(registrationFlow.flowToken),
    data: {
      serviceResultToken: completedCode.serviceResultToken,
      channel: 'registration'
    }
  })
  expect(finalizeRegistration.ok()).toBeTruthy()
  const finalizedRegistration = await finalizeRegistration.json() as { finalization: { kind: string; userId: string; publicKeyHash: string | null } }
  expect(finalizedRegistration.finalization.kind).toBe('registration_result')
  expect(finalizedRegistration.finalization.userId).toBe(userId)
  expect(finalizedRegistration.finalization.publicKeyHash).toBe(signingKeys.publicKeyHash)

  const setPasswordResponse = await request.post(`${AUTH_API_URL}/api/device/set-password`, {
    headers: APP_PROXY_HEADERS,
    data: {
      userId,
      password: 'ChangeMe123!'
    }
  })
  expect(setPasswordResponse.ok()).toBeTruthy()

  const anonymousStepUpFlow = await request.post(`${AUTH_API_URL}/api/step-up-flows`, {
    data: {
      userId,
      requiredAcr: 'level_1'
    }
  })
  expect(anonymousStepUpFlow.status()).toBe(401)

  const deviceLogin = await loginWithDevice(request, {
    publicKeyHash: signingKeys.publicKeyHash,
    privateKey: signingKeys.privateKey
  })

  const createStepUpFlow = await request.post(`${AUTH_API_URL}/api/step-up-flows`, {
    headers: withBearer(deviceLogin.accessToken),
    data: {
      userId,
      requiredAcr: 'level_1'
    }
  })
  expect(createStepUpFlow.status()).toBe(201)
  const stepUpFlow = await createStepUpFlow.json() as { flowId: string; flowToken: string; availableServices: Array<{ id: string }> }
  expect(stepUpFlow.availableServices.map((service) => service.id)).toEqual(['sms_tan'])

  const selectSms = await request.post(`${AUTH_API_URL}/api/flows/${stepUpFlow.flowId}/select-service`, {
    headers: withBearer(stepUpFlow.flowToken),
    data: {
      service: 'sms_tan'
    }
  })
  expect(selectSms.ok()).toBeTruthy()
  const selectedSms = await selectSms.json() as { serviceToken: string }

  const startSms = await request.post(`${AUTH_API_URL}/api/identification/sms-tan/start`, {
    headers: withBearer(selectedSms.serviceToken),
    data: {}
  })
  expect(startSms.ok()).toBeTruthy()
  const startedSms = await startSms.json() as { maskedTarget: string | null; devCode: string | null }
  expect(startedSms.maskedTarget).toContain('+49')
  expect(startedSms.devCode).not.toBeNull()

  const resendSms = await request.post(`${AUTH_API_URL}/api/identification/sms-tan/resend`, {
    headers: withBearer(selectedSms.serviceToken),
    data: {}
  })
  expect(resendSms.ok()).toBeTruthy()
  const resentSms = await resendSms.json() as { devCode: string | null }
  expect(resentSms.devCode).not.toBeNull()
  expect(resentSms.devCode).not.toBe(startedSms.devCode)

  const completeSms = await request.post(`${AUTH_API_URL}/api/identification/sms-tan/complete`, {
    headers: withBearer(selectedSms.serviceToken),
    data: {
      tan: resentSms.devCode
    }
  })
  expect(completeSms.ok()).toBeTruthy()
  const completedSms = await completeSms.json() as { serviceResultToken: string; achievedAcr: string }
  expect(completedSms.achievedAcr).toBe('level_2')

  const finalizeBrowser = await request.post(`${AUTH_API_URL}/api/flows/${stepUpFlow.flowId}/finalize`, {
    headers: withBearer(stepUpFlow.flowToken),
    data: {
      serviceResultToken: completedSms.serviceResultToken,
      channel: 'browser'
    }
  })
  expect(finalizeBrowser.ok()).toBeTruthy()
  const finalizedBrowser = await finalizeBrowser.json() as { finalization: { kind: string; resultCode: string } }
  expect(finalizedBrowser.finalization.kind).toBe('result_code')

  const unauthorizedRedeemResultCode = await request.post(`${AUTH_API_URL}/api/internal/flows/redeem`, {
    data: {
      code: finalizedBrowser.finalization.resultCode,
      kind: 'result_code'
    }
  })
  expect(unauthorizedRedeemResultCode.status()).toBe(401)

  const internalRedeemAccessToken = await getInternalRedeemAccessToken(request)
  const redeemResultCode = await request.post(`${AUTH_API_URL}/api/internal/flows/redeem`, {
    headers: {
      authorization: `Bearer ${internalRedeemAccessToken}`
    },
    data: {
      code: finalizedBrowser.finalization.resultCode,
      kind: 'result_code'
    }
  })
  expect(redeemResultCode.ok()).toBeTruthy()
  const redeemedResult = await redeemResultCode.json() as { userId: string; achievedAcr: string | null }
  expect(redeemedResult.userId).toBe(userId)
  expect(redeemedResult.achievedAcr).toBe('level_2')

  const flowTrace = await waitForTrace(request, userId, 'registration_flow_create', 'auth-api')

  await page.goto(`${TRACE_WEB_URL}#trace/${flowTrace.traceId}`)
  await expect(page.getByRole('heading', { name: 'Detailinspektion' })).toBeVisible()

  const flowTimeline = page.getByRole('list', { name: 'Trace spans timeline' })
  await flowTimeline.getByRole('button', { name: /POST \/api\/registration-flows/i }).click()

  const flowArtifactTabs = page.getByRole('tablist', { name: 'Artifact quick access' })
  await expect(flowArtifactTabs).toContainText('outgoing_response_body')
  await flowArtifactTabs.getByRole('tab', { name: /^outgoing_response_body/i }).click()

  const flowArtifactViewer = page.getByLabel('Artifact viewer')
  await expect(flowArtifactViewer).toContainText('flowToken')
  await expect(flowArtifactViewer).toContainText('Verschachtelt decodiert: body.flowToken')
  await expect(flowArtifactViewer).toContainText('"kind": "flow"')
  await expect(flowArtifactViewer).toContainText(`"flowId": "${registrationFlow.flowId}"`)
})

test('missing saved device binding is cleared instead of failing with a server error', async ({ page, request }) => {
  const userId = `e2e-missing-device-${Date.now()}`
  const deviceName = 'Missing Device Test'
  const registrationCode = `MISS${Date.now().toString(36).toUpperCase()}`
  const registrationResponse = await request.post(`${AUTH_API_URL}/api/admin/registration-identities`, {
    headers: ADMIN_PROXY_HEADERS,
    data: {
      userId,
      firstName: 'Missing',
      lastName: 'User',
      birthDate: '1990-01-01',
      code: registrationCode,
      codeValidForDays: 30
    }
  })

  expect(registrationResponse.ok()).toBeTruthy()

  await page.goto('https://appmock.localhost:8443')
  await page.getByLabel('Benutzer-ID').fill(userId)
  await page.getByLabel('Vorname').fill('Missing')
  await page.getByLabel('Nachname').fill('User')
  await page.getByLabel('Geburtsdatum').fill('1990-01-01')
  await page.getByLabel('Gerätename').fill(deviceName)
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()
  await expect(page.getByRole('heading', { name: 'Verfügbaren Service ausführen' })).toBeVisible()
  await expect(page.getByText('Ein separater Startschritt ist nicht erforderlich.')).toBeVisible()
  await page.getByRole('textbox', { name: 'Registrierungscode' }).fill(registrationCode)
  await page.getByRole('button', { name: 'Identifikation abschließen' }).click()

  await expect(page.getByRole('heading', { name: /Neues Passwort erstellen|Mit gespeichertem Gerät anmelden/ })).toBeVisible()
  if (await page.getByRole('heading', { name: 'Neues Passwort erstellen' }).isVisible().catch(() => false)) {
    await page.getByLabel('Neues Passwort').fill('ChangeMe123!')
    await page.getByRole('button', { name: 'Passwort speichern' }).click()
    await expect(page.getByLabel('Secure element prompt')).toBeVisible()
    await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()
    await expect(page.getByLabel('Authenticated token summary')).toBeVisible()
  }

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Geräteanmeldung starten' })).toBeVisible()

  const devicesResponse = await request.get(`${AUTH_API_URL}/api/admin/devices`, {
    headers: ADMIN_PROXY_HEADERS
  })
  expect(devicesResponse.ok()).toBeTruthy()
  const devices = await devicesResponse.json() as Array<{ id: string; userId: string; deviceName: string }>
  const device = devices.find((item) => item.userId === userId && item.deviceName === deviceName)

  expect(device).toBeTruthy()

  const deleteResponse = await request.delete(`${AUTH_API_URL}/api/admin/devices/${device?.id}`, {
    headers: ADMIN_PROXY_HEADERS
  })
  expect(deleteResponse.status()).toBe(204)

  await page.getByRole('button', { name: 'Mit Gerät fortfahren' }).click()
  await expect(page.getByText('Gespeicherte Gerätebindung war ungültig und wurde entfernt')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dieses Telefon einrichten' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Geräteanmeldung einrichten' })).toBeVisible()

  const storedBinding = await page.evaluate(() => window.localStorage.getItem('auth-sandbox-2.device-binding'))
  expect(storedBinding).toBeNull()
})

test('registration verification shows inline error feedback for invalid code attempts', async ({ page, request }) => {
  const userId = `e2e-invalid-code-${Date.now()}`
  const registrationCode = `CODE${Date.now().toString(36).toUpperCase()}`

  const registrationResponse = await request.post(`${AUTH_API_URL}/api/admin/registration-identities`, {
    headers: ADMIN_PROXY_HEADERS,
    data: {
      userId,
      firstName: 'Invalid',
      lastName: 'Code',
      birthDate: '1990-01-01',
      code: registrationCode,
      codeValidForDays: 30
    }
  })

  expect(registrationResponse.ok()).toBeTruthy()

  await page.goto('https://appmock.localhost:8443')
  await page.getByLabel('Benutzer-ID').fill(userId)
  await page.getByLabel('Vorname').fill('Invalid')
  await page.getByLabel('Nachname').fill('Code')
  await page.getByLabel('Geburtsdatum').fill('1990-01-01')
  await page.getByLabel('Gerätename').fill('Inline Error Device')
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.getByLabel('Secure element prompt')).toBeVisible()
  await page.getByRole('button', { name: 'Displaysperre verwenden' }).click()
  await expect(page.getByRole('heading', { name: 'Verfügbaren Service ausführen' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Registrierungscode' }).fill('WRONGCODE')
  await page.getByRole('button', { name: 'Identifikation abschließen' }).click()

  await expect(page.getByRole('alert')).toContainText('Invalid registration code')
  await expect(page.getByRole('heading', { name: 'Verfügbaren Service ausführen' })).toBeVisible()
})

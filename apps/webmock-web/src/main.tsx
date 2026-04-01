import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { ServiceMockApiAssuranceResponse, ServiceMockApiMessagesResponse, ServiceMockApiProfileResponse } from '@auth-sandbox-2/shared-types'

import './styles.css'
import { buildAuthorizationUrl, getServiceMockApiAccessLabel, normalizeAcr, normalizeAmr } from './state'

const KEYCLOAK_BASE = 'https://keycloak.localhost:8443/realms/auth-sandbox-2/protocol/openid-connect'
const SERVICEMOCK_API_BASE = import.meta.env.VITE_SERVICEMOCK_API_URL ?? '/servicemock-api/api/mock'
const CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'webmock-web'
const REDIRECT_URI = 'https://webmock.localhost:8443/'
const TOKEN_STORAGE_KEY = 'auth-sandbox-2.webmock-web.tokens'
const AUTH_API_BASE = 'https://auth.localhost:8443'
const TRACE_API_BASE = '/trace-api'

type StoredTokens = {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number | null
}

type MessageState = {
  kind: 'info' | 'warn' | 'error'
  text: string
}

type StepUpFlowState = {
  startedAt: string
}

type TraceState = {
  traceId: string
  sessionId: string
}

function randomValue() {
  return crypto.randomUUID()
}

function createTraceState(): TraceState {
  return {
    traceId: crypto.randomUUID(),
    sessionId: crypto.randomUUID()
  }
}

function createTraceHeaders(trace?: TraceState, parentSpanId?: string | null) {
  const nextTrace = trace ?? createTraceState()
  return {
    'x-trace-id': nextTrace.traceId,
    'x-correlation-id': nextTrace.traceId,
    'x-client-name': 'webmock-web',
    ...(nextTrace.sessionId ? { 'x-session-id': nextTrace.sessionId } : {}),
    ...(parentSpanId ? { 'x-span-id': parentSpanId } : {})
  }
}

async function sendClientEvent(input: {
  trace: TraceState
  operation: string
  traceType?: string
  userId?: string | null
  artifacts?: Array<{
    artifactType: string
    name: string
    rawValue: string
    encoding?: string | null
    contentType?: string | null
    explanation?: string | null
  }>
}) {
  // Artifacts sent here are trace-only telemetry for trace-api/client-events.
  // They do not become part of servicemock-api or Keycloak business payloads unless
  // the same data is sent separately by another request.
  await fetch(`${TRACE_API_BASE}/client-events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...createTraceHeaders(input.trace)
    },
    body: JSON.stringify({
      traceId: input.trace.traceId,
      traceType: input.traceType ?? input.operation,
      actorName: 'webmock-web',
      operation: input.operation,
      status: 'success',
      timestamp: new Date().toISOString(),
      userId: input.userId ?? null,
      sessionId: input.trace.sessionId,
      artifacts: input.artifacts?.map((artifact) => ({
        artifactType: artifact.artifactType,
        name: artifact.name,
        contentType: artifact.contentType ?? 'application/json',
        encoding: artifact.encoding ?? 'json',
        direction: 'outbound',
        rawValue: artifact.rawValue,
        explanation: artifact.explanation ?? 'Client-side artifact captured by webmock-web.'
      }))
    })
  })
}

function stringifyArtifact(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split('.')
  if (!payload) {
    return null
  }

  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  try {
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function loadStoredTokens() {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as StoredTokens
  } catch {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    return null
  }
}

function persistTokens(tokens: StoredTokens | null) {
  if (typeof window === 'undefined') {
    return
  }

  if (!tokens) {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens))
}

async function exchangeCode(code: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI
  })

  const response = await fetch(`${KEYCLOAK_BASE}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })

  if (!response.ok) {
    throw new Error('Code exchange failed')
  }

  const result = await response.json() as {
    access_token: string
    id_token: string
    refresh_token: string
    expires_in: number
  }

  return {
    accessToken: result.access_token,
    idToken: result.id_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + result.expires_in * 1000
  } satisfies StoredTokens
}

async function requestJson<T>(path: string, accessToken: string, trace?: TraceState) {
  const response = await fetch(path, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...createTraceHeaders(trace)
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

function WebMockApp() {
  const [tokens, setTokens] = useState<StoredTokens | null>(() => loadStoredTokens())
  const [profile, setProfile] = useState<ServiceMockApiProfileResponse | null>(null)
  const [assurance1, setAssurance1] = useState<ServiceMockApiAssuranceResponse | null>(null)
  const [assurance2, setAssurance2] = useState<ServiceMockApiAssuranceResponse | null>(null)
  const [messages, setMessages] = useState<ServiceMockApiMessagesResponse | null>(null)
  const [messageState, setMessageState] = useState<MessageState | null>(null)
  const [newNote, setNewNote] = useState('')
  const [stepUpFlow, setStepUpFlow] = useState<StepUpFlowState | null>(null)
  const [stepUpTan, setStepUpTan] = useState('')
  const [loading, setLoading] = useState(false)
  const [stepUpTrace, setStepUpTrace] = useState<TraceState | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const error = params.get('error')
    if (error) {
      setMessageState({ kind: 'error', text: `Keycloak login failed: ${error}` })
      return
    }
    if (!code) {
      return
    }

    void exchangeCode(code)
      .then((nextTokens) => {
        setTokens(nextTokens)
        persistTokens(nextTokens)
        setMessageState({ kind: 'info', text: 'Keycloak session established and token bundle stored locally.' })
        window.history.replaceState({}, document.title, window.location.pathname)
      })
      .catch(() => {
        setMessageState({ kind: 'error', text: 'Authorization code exchange failed.' })
      })
  }, [])

  const tokenClaims = useMemo(() => (tokens ? decodeJwtPayload(tokens.accessToken) : null), [tokens])
  const currentAcr = normalizeAcr(tokenClaims?.acr)
  const currentAmr = normalizeAmr(tokenClaims?.amr)

  async function loadProtectedData() {
    if (!tokens) {
      return
    }

    const trace = createTraceState()
    setLoading(true)
    try {
      await sendClientEvent({
        trace,
        operation: 'webmock_web_servicemock_api_load_started',
        traceType: 'webmock_web_servicemock_api_load',
        userId: typeof tokenClaims?.preferred_username === 'string' ? tokenClaims.preferred_username : null,
        artifacts: [
          {
            artifactType: 'event_payload',
            name: 'servicemock_api_request_plan',
            // Trace-only request plan for observability.
            rawValue: stringifyArtifact({ endpoints: ['profile', 'messages', 'assurance/1se', 'assurance/2se'] })
          }
        ]
      })
      const [profileResult, messagesResult, assurance1Result] = await Promise.all([
        requestJson<ServiceMockApiProfileResponse>(`${SERVICEMOCK_API_BASE}/profile`, tokens.accessToken, trace),
        requestJson<ServiceMockApiMessagesResponse>(`${SERVICEMOCK_API_BASE}/messages`, tokens.accessToken, trace),
        requestJson<ServiceMockApiAssuranceResponse>(`${SERVICEMOCK_API_BASE}/assurance/1se`, tokens.accessToken, trace)
      ])
      setProfile(profileResult)
      setMessages(messagesResult)
      setAssurance1(assurance1Result)

      try {
        const assurance2Result = await requestJson<ServiceMockApiAssuranceResponse>(`${SERVICEMOCK_API_BASE}/assurance/2se`, tokens.accessToken, trace)
        setAssurance2(assurance2Result)
      } catch {
        setAssurance2(null)
      }

      await sendClientEvent({
        trace,
        operation: 'webmock_web_servicemock_api_load_finished',
        traceType: 'webmock_web_servicemock_api_load',
        userId: profileResult.userId,
        artifacts: [
          {
            artifactType: 'event_payload',
            name: 'servicemock_api_profile',
            // Trace-only copy of the response payload for the trace explorer.
            rawValue: stringifyArtifact(profileResult)
          },
          {
            artifactType: 'event_payload',
            name: 'servicemock_api_messages',
            // Trace-only copy of the response payload for the trace explorer.
            rawValue: stringifyArtifact(messagesResult)
          },
          {
            artifactType: 'event_payload',
            name: 'servicemock_api_assurance_1se',
            // Trace-only copy of the response payload for the trace explorer.
            rawValue: stringifyArtifact(assurance1Result)
          }
        ]
      })

      setMessageState({ kind: 'info', text: 'ServiceMock API data refreshed.' })
    } catch (error) {
      setMessageState({ kind: 'error', text: error instanceof Error ? error.message : 'ServiceMock API request failed.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!tokens) {
      setProfile(null)
      setMessages(null)
      setAssurance1(null)
      setAssurance2(null)
      return
    }

    void loadProtectedData()
  }, [tokens])

  async function createNote() {
    if (!tokens || !newNote.trim()) {
      return
    }

    const trace = createTraceState()
    setLoading(true)
    try {
      await sendClientEvent({
        trace,
        operation: 'webmock_web_note_create_started',
        traceType: 'webmock_web_note_create',
        userId: typeof tokenClaims?.preferred_username === 'string' ? tokenClaims.preferred_username : null,
        artifacts: [
          {
            artifactType: 'event_payload',
            name: 'mock_note_request',
            // Trace-only mirror of the note payload; servicemock-api receives its own
            // POST body in the request right below.
            rawValue: stringifyArtifact({ text: newNote.trim() })
          }
        ]
      })
      await fetch(`${SERVICEMOCK_API_BASE}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
          'content-type': 'application/json',
          ...createTraceHeaders(trace)
        },
        body: JSON.stringify({ text: newNote.trim() })
      })
      await sendClientEvent({
        trace,
        operation: 'webmock_web_note_create_finished',
        traceType: 'webmock_web_note_create',
        userId: typeof tokenClaims?.preferred_username === 'string' ? tokenClaims.preferred_username : null
      })
      setNewNote('')
      await loadProtectedData()
    } catch (error) {
      setMessageState({ kind: 'error', text: error instanceof Error ? error.message : 'Creating a protected note failed.' })
    } finally {
      setLoading(false)
    }
  }

  function startLogin(acrValues: '1se' | '2se') {
    const loginHint = typeof tokenClaims?.preferred_username === 'string' ? tokenClaims.preferred_username : null
    const trace = createTraceState()
    void sendClientEvent({
      trace,
      operation: 'webmock_web_login_redirect_started',
      traceType: 'webmock_web_login_redirect',
      userId: loginHint,
      artifacts: [
        {
          artifactType: 'url',
          name: 'keycloak_browser_auth_request',
          rawValue: stringifyArtifact({ acrValues })
        }
      ]
    }).finally(() => {
      const url = buildAuthorizationUrl({
        authorizationEndpoint: `${KEYCLOAK_BASE}/auth`,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        acrValues,
        state: randomValue(),
        nonce: randomValue(),
        traceHint: trace.traceId,
        loginHint: acrValues === '2se' ? loginHint : null
      })
      window.location.assign(url)
    })
  }

  async function startInteractiveStepUp() {
    if (!tokens) {
      setMessageState({ kind: 'warn', text: 'Log in with 1se first so the browser flow has an active Keycloak session.' })
      return
    }

    const trace = createTraceState()
    setLoading(true)
    try {
      await sendClientEvent({
        trace,
        operation: 'webmock_web_step_up_started',
        traceType: 'webmock_web_step_up',
        userId: typeof tokenClaims?.preferred_username === 'string' ? tokenClaims.preferred_username : null,
        artifacts: [
          {
            artifactType: 'event_payload',
            name: 'step_up_request',
            // Trace-only note that the UI requested 2se step-up.
            rawValue: stringifyArtifact({ requestedAcr: '2se' })
          }
        ]
      })
      setStepUpFlow({ startedAt: new Date().toISOString() })
      setStepUpTrace(trace)
      await sendClientEvent({
        trace,
        operation: 'webmock_web_step_up_challenge_ready',
        traceType: 'webmock_web_step_up',
        userId: typeof tokenClaims?.preferred_username === 'string' ? tokenClaims.preferred_username : null,
        artifacts: [
          {
            artifactType: 'event_payload',
            name: 'sms_tan_challenge',
            // Trace-only UI state marker; the actual challenge happens in the
            // Keycloak browser flow, not via this client-event payload.
            rawValue: stringifyArtifact({ mode: 'keycloak_inline' })
          }
        ]
      })
      setMessageState({ kind: 'info', text: 'Keycloak step-up is starting. Complete the SMS-TAN in the Keycloak dialog.' })
      const url = buildAuthorizationUrl({
        authorizationEndpoint: `${KEYCLOAK_BASE}/auth`,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        acrValues: '2se',
        state: randomValue(),
        nonce: randomValue(),
        traceHint: trace.traceId,
        loginHint: typeof tokenClaims?.preferred_username === 'string' ? tokenClaims.preferred_username : null
      })
      window.location.assign(url)
    } catch (error) {
      setMessageState({ kind: 'error', text: error instanceof Error ? error.message : 'Failed to prepare step-up flow.' })
    } finally {
      setLoading(false)
    }
  }

  function logout() {
    persistTokens(null)
    setTokens(null)
    setMessageState({ kind: 'warn', text: 'Local webmock-web tokens cleared. Log out in Keycloak separately if you want to remove the SSO cookie.' })
  }

  return (
    <main className="shell">
      <section className="hero stack">
        <p className="eyebrow">WebMock Web</p>
        <h1>Browser login starts with 1se and can later step up to 2se through a fresh Keycloak auth request.</h1>
        <p>This demo keeps the first browser sign-in at password level and only upgrades to 2se when you explicitly trigger step-up for the stronger servicemock-api endpoint.</p>
        <div className="status-list" aria-label="WebMock status cards">
          <article className="status-item">
            <span>Current acr</span>
            <strong>{currentAcr ?? 'none'}</strong>
          </article>
          <article className="status-item">
            <span>Current amr</span>
            <strong>{currentAmr.length ? currentAmr.join(', ') : 'none'}</strong>
          </article>
          <article className="status-item">
            <span>Access rule</span>
            <strong>{getServiceMockApiAccessLabel(currentAcr)}</strong>
          </article>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => startLogin('1se')}>Mit Keycloak 1se anmelden</button>
          <button type="button" className="secondary" onClick={() => void startInteractiveStepUp()}>Step-up auf 2se starten</button>
          <button type="button" className="secondary" onClick={logout}>Lokale Sitzung leeren</button>
        </div>
      </section>

      {messageState && <section className={`message ${messageState.kind}`}>{messageState.text}</section>}

      <section className="shell-grid">
        <section className="stack">
          <section className="card stack">
            <p className="eyebrow">Keycloak Session</p>
            <h2>Token claims and browser session</h2>
            <div className="token-grid">
              <article className="token-item">
                <span>Has token</span>
                <strong>{tokens ? 'yes' : 'no'}</strong>
              </article>
              <article className="token-item">
                <span>Client</span>
                <strong>{typeof tokenClaims?.azp === 'string' ? tokenClaims.azp : 'webmock-web'}</strong>
              </article>
              <article className="token-item">
                <span>Expires</span>
                <strong>{tokens?.expiresAt ? new Date(tokens.expiresAt).toISOString() : 'n/a'}</strong>
              </article>
            </div>
            <pre className="json-block" aria-label="Decoded access token claims">{JSON.stringify(tokenClaims, null, 2)}</pre>
          </section>

          <section className="card stack">
            <p className="eyebrow">Protected ServiceMock API</p>
            <h2>Call the reused demo backend with the current Keycloak token</h2>
            <div className="api-grid">
              <article className="api-card">
                <span>1se endpoint</span>
                <strong>{assurance1 ? assurance1.message : 'Not loaded yet'}</strong>
              </article>
              <article className="api-card">
                <span>2se endpoint</span>
                <strong>{assurance2 ? assurance2.message : 'Step-up to 2se to unlock this endpoint.'}</strong>
              </article>
            </div>
            {profile && <pre className="json-block" aria-label="Mock profile response">{JSON.stringify(profile, null, 2)}</pre>}
          </section>

          <section className="card stack">
            <p className="eyebrow">Protected Notes</p>
            <h2>Post a demo note through the existing servicemock-api</h2>
            <div className="form-grid">
              <label>
                Neue geschützte Notiz
                <textarea value={newNote} onChange={(event) => setNewNote(event.target.value)} />
              </label>
              <div className="button-row">
                <button type="button" onClick={() => void createNote()} disabled={!tokens || loading || !newNote.trim()}>Notiz an ServiceMock API senden</button>
                <button type="button" className="secondary" onClick={() => void loadProtectedData()} disabled={!tokens || loading}>ServiceMock API neu laden</button>
              </div>
            </div>
            <pre className="json-block" aria-label="WebMock message response">{JSON.stringify(messages, null, 2)}</pre>
          </section>
        </section>

        <section className="stack">
          <section className="card stack">
            <p className="eyebrow">Step-up Hint</p>
            <h2>How the current repo handles browser step-up</h2>
            <div className="stepup-grid">
              <article className="stepup-card">
                <strong>1se login</strong>
                <p>Start a normal browser auth request with <code>acr_values=1se</code>. Keycloak should satisfy that through the password branch.</p>
              </article>
              <article className="stepup-card">
                <strong>2se step-up</strong>
                <p>Trigger a fresh auth request with <code>acr_values=2se</code>. Keycloak LoA conditions should route that request into the inline SMS-TAN step-up branch.</p>
              </article>
            </div>
            <div className="tan-card">
              <span>Browser step-up</span>
              <strong>{stepUpFlow ? 'The next Keycloak screen will ask for the SMS-TAN directly.' : 'No Keycloak step-up running.'}</strong>
            </div>
          </section>

          <section className="card stack">
            <p className="eyebrow">Demo Limits</p>
            <h2>Current implementation notes</h2>
            <div className="tan-card">
              <span>SMS-TAN</span>
              <strong>The TAN is intentionally shown in the demo UI after challenge start so browser and app flows stay interactive without a real SMS gateway.</strong>
            </div>
              <div className="tan-card">
                <span>Tracing</span>
                <strong>ServiceMock requests, browser client events, and the inline browser step-up path all emit traces that can be inspected in Trace Web.</strong>
              </div>
            </section>
        </section>
      </section>
    </main>
  )
}

if (typeof document !== 'undefined') {
  const rootElement = document.getElementById('root')
  if (rootElement) {
    createRoot(rootElement).render(
      <StrictMode>
        <WebMockApp />
      </StrictMode>
    )
  }
}

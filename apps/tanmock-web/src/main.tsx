import { StrictMode, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'

import type { CreateTanMockAdminRecordInput, TanMockAdminOverview } from '@auth-sandbox-2/shared-types'

import './styles.css'

const API_BASE = import.meta.env.VITE_TANMOCK_API_URL ?? ''
const KEYCLOAK_BASE = 'https://keycloak.localhost:8443/realms/auth-sandbox-2/protocol/openid-connect'
const CLIENT_ID = 'tanmock-admin-web'
const REDIRECT_URI = 'https://tanmock.localhost:8443/'
const TOKEN_STORAGE_KEY = 'auth-sandbox-2.tanmock-admin.tokens'

type StoredTokens = {
  accessToken: string
  expiresAt: number | null
}

function randomValue() {
  return crypto.randomUUID()
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

function buildAuthorizationUrl() {
  const url = new URL(`${KEYCLOAK_BASE}/auth`)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile email')
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('state', randomValue())
  return url.toString()
}

async function exchangeCode(code: string) {
  const response = await fetch(`${KEYCLOAK_BASE}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI
    })
  })

  if (!response.ok) {
    throw new Error('Code exchange failed')
  }

  const body = await response.json() as { access_token: string; expires_in: number }
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000
  } satisfies StoredTokens
}

async function requestJson<T>(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }
  return response.json() as Promise<T>
}

function TanMockAdminApp() {
  const [tokens, setTokens] = useState<StoredTokens | null>(() => loadStoredTokens())
  const [overview, setOverview] = useState<TanMockAdminOverview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CreateTanMockAdminRecordInput>({
    tan: '471199',
    userId: 'demo-user',
    sourceUserId: 'demo-user'
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) {
      return
    }

    void exchangeCode(code)
      .then((nextTokens) => {
        setTokens(nextTokens)
        persistTokens(nextTokens)
        window.history.replaceState({}, document.title, window.location.pathname)
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : 'Keycloak login failed')
      })
  }, [])

  useEffect(() => {
    if (!tokens) {
      return
    }
    void requestJson<TanMockAdminOverview>('/api/admin/entries', tokens.accessToken)
      .then(setOverview)
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : 'Overview konnte nicht geladen werden.')
      })
  }, [tokens])

  const activeEntries = useMemo(() => overview?.entries.filter((entry) => entry.active) ?? [], [overview])

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!tokens) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestJson('/api/admin/entries', tokens.accessToken, {
        method: 'POST',
        body: JSON.stringify(form)
      })
      const refreshed = await requestJson<TanMockAdminOverview>('/api/admin/entries', tokens.accessToken)
      setOverview(refreshed)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Eintrag konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="tanmock-shell">
      <section className="tanmock-hero card">
        <p className="eyebrow">Mock OIDC Admin</p>
        <h1>TAN-basierte Broker-Logins verwalten</h1>
        <p>Diese Oberfläche ist selbst über Keycloak geschützt und pflegt die einmalig nutzbaren Demo-TANs für den externen OIDC-Broker.</p>
        {!tokens ? <a className="button-link" href={buildAuthorizationUrl()}>Mit Keycloak anmelden</a> : <p className="login-state">Admin-Session aktiv</p>}
      </section>

      {error ? <section className="card error-card" role="alert">{error}</section> : null}

      <section className="tanmock-grid">
        <section className="card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Neue TAN</p>
              <h2>Broker-Eintrag anlegen</h2>
            </div>
          </div>
          <form className="tanmock-form" onSubmit={handleCreate}>
            <label>
              TAN
              <input value={form.tan} onChange={(event) => setForm({ ...form, tan: event.target.value })} disabled={!tokens || busy} />
            </label>
            <label>
              User ID
              <input value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} disabled={!tokens || busy} />
            </label>
            <label>
              Source User ID
              <input value={form.sourceUserId} onChange={(event) => setForm({ ...form, sourceUserId: event.target.value })} disabled={!tokens || busy} />
            </label>
            <button type="submit" disabled={!tokens || busy}>{busy ? 'Speichert...' : 'TAN speichern'}</button>
          </form>
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Aktive TANs</p>
              <h2>Verfügbare Broker-Logins</h2>
            </div>
            <strong>{activeEntries.length}</strong>
          </div>
          <div className="tanmock-list" aria-label="Aktive TAN-Eintraege">
            {activeEntries.map((entry) => (
              <article key={entry.id}>
                <strong>{entry.userId}</strong>
                <span>TAN: {entry.tan}</span>
                <span>Quelle: {entry.sourceUserId}</span>
              </article>
            ))}
            {!activeEntries.length ? <p>Noch keine aktive TAN hinterlegt.</p> : null}
          </div>
        </section>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TanMockAdminApp />
  </StrictMode>
)

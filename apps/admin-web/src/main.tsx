import { StrictMode, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'

import type { CreateRegistrationIdentityInput, DeviceRecord, RegistrationIdentityRecord } from '@auth-sandbox-2/shared-types'

import './styles.css'

const API_BASE = import.meta.env.VITE_AUTH_API_URL ?? 'https://auth.localhost:8443'
export const TRACE_VIEWER_URL = 'https://trace.localhost:8443/'
export const TRACE_VIEWER_ENTRY = {
  title: 'Trace Viewer oeffnen',
  href: TRACE_VIEWER_URL,
  description: 'Springe direkt in den Trace Viewer, um aktuelle Flows, verschluesselte Challenge-Payloads und decodierte JWT-Claims nachzuvollziehen.',
  highlights: ['Live-Trace-Liste mit Suche', 'Detailinspektion pro Trace', 'Artefakte, Proxy-Hops und JWT-Claims']
} as const

function createAdminHeaders() {
  const traceId = crypto.randomUUID()
  return {
    'x-trace-id': traceId,
    'x-correlation-id': traceId,
    'x-client-name': 'admin-web'
  }
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...createAdminHeaders(),
      ...(init?.headers ?? {})
    }
  })

  if (!response.ok) {
    throw new Error(parseApiErrorMessage(await response.text()))
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export function parseApiErrorMessage(rawMessage: string) {
  try {
    const parsed = JSON.parse(rawMessage) as { message?: unknown }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message
    }
  } catch {
    // fall through to plain-text handling
  }

  const normalized = rawMessage.trim()
  return normalized || 'Identitaet konnte nicht gespeichert werden.'
}

export function filterDevices(devices: DeviceRecord[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return devices
  }

  return devices.filter((device) => {
    const haystack = [device.userId, device.deviceName, device.publicKeyHash].join(' ').toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}

export function filterRegistrationIdentities(registrationIdentities: RegistrationIdentityRecord[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return registrationIdentities
  }

  return registrationIdentities.filter((identity) => {
    const haystack = [
      identity.userId,
      identity.firstName,
      identity.lastName,
      identity.birthDate,
      identity.code ?? '',
      identity.phoneNumber ?? ''
    ].join(' ').toLowerCase()

    return haystack.includes(normalizedQuery)
  })
}

function AdminApp() {
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [registrationIdentities, setRegistrationIdentities] = useState<RegistrationIdentityRecord[]>([])
  const [deviceQuery, setDeviceQuery] = useState('')
  const [identityQuery, setIdentityQuery] = useState('')
  const [identitySaveError, setIdentitySaveError] = useState<string | null>(null)
  const [identitySavePending, setIdentitySavePending] = useState(false)
  const [identityForm, setIdentityForm] = useState<CreateRegistrationIdentityInput>({
    userId: 'demo-user',
    firstName: 'Demo',
    lastName: 'User',
    birthDate: '1990-01-01',
    code: 'A1B2C3D4',
    codeValidForDays: 30,
    phoneNumber: '+491701234567'
  })

  async function refresh() {
    const [devicesResult, registrationIdentitiesResult] = await Promise.all([
      request<DeviceRecord[]>('/api/admin/devices'),
      request<RegistrationIdentityRecord[]>('/api/admin/registration-identities')
    ])
    setDevices(devicesResult)
    setRegistrationIdentities(registrationIdentitiesResult)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleCreateIdentity(event: FormEvent) {
    event.preventDefault()
    setIdentitySavePending(true)
    setIdentitySaveError(null)

    try {
      await request('/api/admin/registration-identities', {
        method: 'POST',
        body: JSON.stringify(identityForm)
      })
      await refresh()
    } catch (error) {
      setIdentitySaveError(error instanceof Error ? error.message : 'Identitaet konnte nicht gespeichert werden.')
    } finally {
      setIdentitySavePending(false)
    }
  }

  const filteredDevices = useMemo(() => filterDevices(devices, deviceQuery), [deviceQuery, devices])

  const filteredRegistrationIdentities = useMemo(
    () => filterRegistrationIdentities(registrationIdentities, identityQuery),
    [identityQuery, registrationIdentities]
  )

  return (
    <main className="shell admin-overview-shell">
      <section className="admin-overview-grid">
        <section className="admin-top-grid">
          <section className="card hero admin-hero">
            <p className="eyebrow">Admin-Oberflaeche</p>
            <h1>Bereite Registrierungsidentitaeten vor und behalte bestehende Geraetebindungen im Blick.</h1>
            <p className="section-copy">
              Diese Anwendung bleibt bewusst bei den taeglichen Verwaltungsaufgaben fuer Registrierung und Geraetebindung.
            </p>
            <div className="admin-summary-row" aria-label="Admin Ueberblickszahlen">
              <article className="admin-summary-chip">
                <span>Identitaeten</span>
                <strong>{registrationIdentities.length}</strong>
              </article>
              <article className="admin-summary-chip">
                <span>Geraete</span>
                <strong>{devices.length}</strong>
              </article>
            </div>
          </section>

          <section className="card admin-trace-card">
            <p className="eyebrow">Trace Viewer</p>
            <h2>Springe vom Admin-Ueberblick direkt in die Trace-Analyse.</h2>
            <p className="section-copy">{TRACE_VIEWER_ENTRY.description}</p>
            <div className="trace-entry-card" aria-label="Trace Viewer Einstieg">
              {TRACE_VIEWER_ENTRY.highlights.map((highlight) => (
                <article key={highlight} className="admin-trace-highlight">
                  <strong>{highlight}</strong>
                </article>
              ))}
            </div>
            <div className="button-row">
              <a className="button-link" href={TRACE_VIEWER_ENTRY.href} target="_blank" rel="noreferrer">
                {TRACE_VIEWER_ENTRY.title}
              </a>
            </div>
          </section>
        </section>

        <section className="card admin-form-card">
          <div className="list-card-header">
            <div>
              <h2>Registrierungsidentität vorbereiten</h2>
              <p className="section-copy">Lege Person, optionalen Code und optionale SMS-Zielnummer getrennt ab. Das auth-api orchestriert nur den Flow; konkrete Identifikationsservices werden selektiert und können später in eigene Backend-Container ausgelagert werden.</p>
            </div>
          </div>
          {identitySaveError ? <p className="form-error" role="alert">{identitySaveError}</p> : null}
          <form className="grid" onSubmit={handleCreateIdentity}>
            <label>
              User ID
              <input name="userId" value={identityForm.userId} onChange={(event) => setIdentityForm({ ...identityForm, userId: event.target.value })} disabled={identitySavePending} />
            </label>
            <label>
              Vorname
              <input name="firstName" value={identityForm.firstName} onChange={(event) => setIdentityForm({ ...identityForm, firstName: event.target.value })} disabled={identitySavePending} />
            </label>
            <label>
              Nachname
              <input name="lastName" value={identityForm.lastName} onChange={(event) => setIdentityForm({ ...identityForm, lastName: event.target.value })} disabled={identitySavePending} />
            </label>
            <label>
              Geburtsdatum
              <input name="birthDate" type="date" value={identityForm.birthDate} onChange={(event) => setIdentityForm({ ...identityForm, birthDate: event.target.value })} disabled={identitySavePending} />
            </label>
            <label>
              Code
              <input name="code" value={identityForm.code ?? ''} onChange={(event) => setIdentityForm({ ...identityForm, code: event.target.value || undefined })} disabled={identitySavePending} />
            </label>
            <label>
              Code gültig für Tage
              <input name="codeValidForDays" type="number" value={identityForm.codeValidForDays ?? 30} onChange={(event) => setIdentityForm({ ...identityForm, codeValidForDays: Number(event.target.value) })} disabled={identitySavePending} />
            </label>
            <label>
              Telefonnummer
              <input name="phoneNumber" value={identityForm.phoneNumber ?? ''} onChange={(event) => setIdentityForm({ ...identityForm, phoneNumber: event.target.value || undefined })} disabled={identitySavePending} />
            </label>
            <button type="submit" disabled={identitySavePending}>{identitySavePending ? 'Speichert...' : 'Identität speichern'}</button>
          </form>
        </section>

        <section className="admin-list-grid">
          <section className="card list-card admin-list-card">
            <div className="list-card-header">
              <div>
                <h2>Registrierungsidentitaeten</h2>
                <p className="section-copy">Vorbereitete Personen mit optionalem Code und optionaler SMS-Zielnummer.</p>
              </div>
              <strong>{registrationIdentities.length}</strong>
            </div>
            <label className="admin-list-search">
              Identitaeten durchsuchen
                <input
                  name="identityQuery"
                  aria-label="Identitaeten durchsuchen"
                  placeholder="User ID, Name, Code oder Telefonnummer suchen"
                  value={identityQuery}
                onChange={(event) => setIdentityQuery(event.target.value)}
              />
            </label>
            <div className="list admin-list-scroll">
              {filteredRegistrationIdentities.map((identity) => (
                <article key={identity.id}>
                  <strong>{identity.userId}</strong>
                  <span>{identity.firstName} {identity.lastName}</span>
                  <span>Geburtsdatum: {identity.birthDate}</span>
                  <span>Code: {identity.code ?? 'nicht gesetzt'}</span>
                  <span>SMS: {identity.phoneNumber ?? 'nicht gesetzt'}</span>
                </article>
              ))}
              {!filteredRegistrationIdentities.length && <p>{registrationIdentities.length ? 'Keine Identitaeten passen zur aktuellen Suche.' : 'Noch keine Registrierungsidentitaeten vorbereitet.'}</p>}
            </div>
          </section>

          <section className="card list-card admin-list-card">
            <div className="list-card-header">
              <div>
                <h2>Geraete</h2>
                <p className="section-copy">Bereits registrierte Geraetebindungen im Demo-System.</p>
              </div>
              <strong>{devices.length}</strong>
            </div>
            <label className="admin-list-search">
              Geraete durchsuchen
                <input
                  name="deviceQuery"
                  aria-label="Geraete durchsuchen"
                  placeholder="User ID, Geraetename oder Hash suchen"
                  value={deviceQuery}
                onChange={(event) => setDeviceQuery(event.target.value)}
              />
            </label>
            <div className="list admin-list-scroll">
              {filteredDevices.map((device) => (
                <article key={device.id}>
                  <strong>{device.userId}</strong>
                  <span>{device.deviceName}</span>
                  <span>{device.publicKeyHash}</span>
                </article>
              ))}
              {!filteredDevices.length && <p>{devices.length ? 'Keine Geraete passen zur aktuellen Suche.' : 'Noch keine Geraete registriert.'}</p>}
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
        <AdminApp />
      </StrictMode>
    )
  }
}

import { StrictMode, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'

import type { DeviceRecord, RegistrationCodeRecord } from '@auth-sandbox-2/shared-types'

import './styles.css'

const API_BASE = import.meta.env.VITE_AUTH_API_URL ?? 'https://auth.localhost:8443'
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
    throw new Error(await response.text())
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function AdminApp() {
  const [codes, setCodes] = useState<RegistrationCodeRecord[]>([])
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [codeQuery, setCodeQuery] = useState('')
  const [deviceQuery, setDeviceQuery] = useState('')
  const [form, setForm] = useState({ userId: 'demo-user', displayName: 'Demo User', validForDays: 30 })

  async function refresh() {
    const [codesResult, devicesResult] = await Promise.all([
      request<RegistrationCodeRecord[]>('/api/admin/registration-codes'),
      request<DeviceRecord[]>('/api/admin/devices')
    ])

    setCodes(codesResult)
    setDevices(devicesResult)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    await request('/api/admin/registration-codes', {
      method: 'POST',
      body: JSON.stringify(form)
    })
    await refresh()
  }

  const filteredCodes = useMemo(() => {
    const query = codeQuery.trim().toLowerCase()
    if (!query) {
      return codes
    }

    return codes.filter((code) => {
      const haystack = [code.userId, code.code, String(code.useCount)].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [codeQuery, codes])

  const filteredDevices = useMemo(() => {
    const query = deviceQuery.trim().toLowerCase()
    if (!query) {
      return devices
    }

    return devices.filter((device) => {
      const haystack = [device.userId, device.deviceName, device.publicKeyHash].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [deviceQuery, devices])

  return (
    <main className="shell admin-overview-shell">
      <section className="admin-overview-grid">
        <section className="card hero admin-hero">
          <p className="eyebrow">Admin-Oberflaeche</p>
          <h1>Verwalte Registrierungscodes und behalte bestehende Geraetebindungen im Blick.</h1>
          <p className="section-copy">
            Diese Anwendung bleibt bewusst bei den taeglichen Verwaltungsaufgaben fuer Registrierung und Geraetebindung.
          </p>
          <div className="admin-summary-row" aria-label="Admin Ueberblickszahlen">
            <article className="admin-summary-chip">
              <span>Registrierungscodes</span>
              <strong>{codes.length}</strong>
            </article>
            <article className="admin-summary-chip">
              <span>Geraete</span>
              <strong>{devices.length}</strong>
            </article>
          </div>
        </section>

        <section className="card admin-form-card">
          <div className="list-card-header">
            <div>
              <h2>Registrierungscode erstellen</h2>
              <p className="section-copy">Lege neue Aktivierungscodes an, damit Geraete schnell fuer den Demo-Flow registriert werden koennen.</p>
            </div>
          </div>
          <form className="grid" onSubmit={handleCreate}>
            <label>
              User ID
              <input value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} />
            </label>
            <label>
              Anzeigename
              <input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
            </label>
            <label>
              Gueltig fuer Tage
              <input type="number" value={form.validForDays} onChange={(event) => setForm({ ...form, validForDays: Number(event.target.value) })} />
            </label>
            <button type="submit">Code erstellen</button>
          </form>
        </section>

        <section className="admin-list-grid">
          <section className="card list-card admin-list-card">
            <div className="list-card-header">
              <div>
                <h2>Registrierungscodes</h2>
                <p className="section-copy">Aktive Codes fuer neue Geraete-Registrierungen.</p>
              </div>
              <strong>{codes.length}</strong>
            </div>
            <label className="admin-list-search">
              Registrierungscodes durchsuchen
              <input
                aria-label="Registrierungscodes durchsuchen"
                placeholder="User ID, Code oder Nutzung suchen"
                value={codeQuery}
                onChange={(event) => setCodeQuery(event.target.value)}
              />
            </label>
            <div className="list admin-list-scroll">
              {filteredCodes.map((code) => (
                <article key={code.id}>
                  <strong>{code.userId}</strong>
                  <span>{code.code}</span>
                  <span>Nutzungen: {code.useCount}</span>
                </article>
              ))}
              {!filteredCodes.length && <p>{codes.length ? 'Keine Registrierungscodes passen zur aktuellen Suche.' : 'Noch keine Registrierungscodes vorhanden.'}</p>}
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>
)

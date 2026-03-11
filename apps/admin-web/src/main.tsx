import { StrictMode, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'

import type { DeviceRecord, RegistrationCodeRecord } from '@auth-sandbox-2/shared-types'

import './styles.css'

const API_BASE = import.meta.env.VITE_AUTH_API_URL ?? 'https://auth.localhost:8443'

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
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

  return (
    <main className="shell">
      <section className="card hero">
        <p className="eyebrow">Admin Web</p>
        <h1>Create registration codes and manage devices.</h1>
      </section>

      <section className="card">
        <h2>Create registration code</h2>
        <form className="grid" onSubmit={handleCreate}>
          <label>
            User ID
            <input value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} />
          </label>
          <label>
            Display name
            <input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
          </label>
          <label>
            Valid for days
            <input type="number" value={form.validForDays} onChange={(event) => setForm({ ...form, validForDays: Number(event.target.value) })} />
          </label>
          <button type="submit">Create code</button>
        </form>
      </section>

      <section className="card list-card">
        <h2>Registration codes</h2>
        <div className="list">
          {codes.map((code) => (
            <article key={code.id}>
              <strong>{code.userId}</strong>
              <span>{code.code}</span>
              <span>uses: {code.useCount}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="card list-card">
        <h2>Devices</h2>
        <div className="list">
          {devices.map((device) => (
            <article key={device.id}>
              <strong>{device.userId}</strong>
              <span>{device.deviceName}</span>
              <span>{device.publicKeyHash}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>
)

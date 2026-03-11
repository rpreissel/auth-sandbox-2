import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import type { FinishLoginResponse, StartLoginResponse } from '@auth-sandbox-2/shared-types'

import { api } from './api'
import { createSigningKeys, exportPrivateKey, importPrivateKey, signEncryptedData } from './crypto'

type ClaimRecord = Record<string, unknown>

type DeviceState = {
  userId: string
  deviceName: string
  publicKey: string
  publicKeyHash: string
  privateKey: CryptoKey
}

type Step = 'register' | 'password' | 'login' | 'authenticated'

type StoredDeviceBinding = {
  userId: string
  deviceName: string
  publicKey: string
  publicKeyHash: string
  privateKey: string
  passwordRequired: boolean
}

const DEVICE_BINDING_STORAGE_KEY = 'auth-sandbox-2.device-binding'

function createInitialForm() {
  return {
    userId: 'demo-user',
    deviceName: 'Browser Device',
    activationCode: '',
    password: 'ChangeMe123!'
  }
}

function readStoredDeviceBinding() {
  const raw = window.localStorage.getItem(DEVICE_BINDING_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredDeviceBinding>
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.deviceName !== 'string' ||
      typeof parsed.publicKey !== 'string' ||
      typeof parsed.publicKeyHash !== 'string' ||
      typeof parsed.privateKey !== 'string' ||
      typeof parsed.passwordRequired !== 'boolean'
    ) {
      return null
    }

    return parsed as StoredDeviceBinding
  } catch {
    return null
  }
}

async function persistDeviceBinding(device: DeviceState, passwordRequired: boolean) {
  const serializedPrivateKey = await exportPrivateKey(device.privateKey)
  const stored: StoredDeviceBinding = {
    userId: device.userId,
    deviceName: device.deviceName,
    publicKey: device.publicKey,
    publicKeyHash: device.publicKeyHash,
    privateKey: serializedPrivateKey,
    passwordRequired
  }

  window.localStorage.setItem(DEVICE_BINDING_STORAGE_KEY, JSON.stringify(stored))
}

function clearDeviceBinding() {
  window.localStorage.removeItem(DEVICE_BINDING_STORAGE_KEY)
}

export function App() {
  const [step, setStep] = useState<Step>('register')
  const [status, setStatus] = useState<string>('Ready')
  const [device, setDevice] = useState<DeviceState | null>(null)
  const [challenge, setChallenge] = useState<StartLoginResponse | null>(null)
  const [tokens, setTokens] = useState<FinishLoginResponse | null>(null)
  const [form, setForm] = useState(createInitialForm)

  const accessClaims = useMemo<ClaimRecord | null>(() => tokens?.accessTokenClaims ?? null, [tokens])
  const idClaims = useMemo<ClaimRecord | null>(() => tokens?.idTokenClaims ?? null, [tokens])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const stored = readStoredDeviceBinding()
      if (!stored) {
        return
      }

      try {
        const privateKey = await importPrivateKey(stored.privateKey)
        if (cancelled) {
          return
        }

        setDevice({
          userId: stored.userId,
          deviceName: stored.deviceName,
          publicKey: stored.publicKey,
          publicKeyHash: stored.publicKeyHash,
          privateKey
        })
        setForm((current) => ({
          ...current,
          userId: stored.userId,
          deviceName: stored.deviceName,
          activationCode: ''
        }))
        setStep(stored.passwordRequired ? 'password' : 'login')
        setStatus('Loaded saved device binding from this browser')
      } catch {
        clearDeviceBinding()
        if (!cancelled) {
          setStatus('Saved device binding was invalid and has been cleared')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleRegister(event: FormEvent) {
    event.preventDefault()
    setStatus('Generating device keys...')
    const signingKeys = await createSigningKeys()
    setStatus('Registering device...')
    const result = await api.registerDevice({
      userId: form.userId,
      deviceName: form.deviceName,
      activationCode: form.activationCode,
      publicKey: signingKeys.publicKey
    })

    const nextDevice = {
      userId: form.userId,
      deviceName: result.deviceName,
      publicKey: signingKeys.publicKey,
      publicKeyHash: result.publicKeyHash,
      privateKey: signingKeys.privateKey
    }

    setDevice(nextDevice)
    await persistDeviceBinding(nextDevice, result.passwordRequired)
    setStatus(`Device registered: ${result.deviceName}`)
    setStep(result.passwordRequired ? 'password' : 'login')
  }

  async function handlePassword(event: FormEvent) {
    event.preventDefault()
    if (!device) return
    setStatus('Setting password in backend...')
    await api.setPassword({ userId: device.userId, password: form.password })
    await persistDeviceBinding(device, false)
    setStatus('Password set')
    setStep('login')
  }

  async function handleStartLogin() {
    if (!device) return
    setStatus('Requesting encrypted challenge...')
    const result = await api.startLogin({ publicKeyHash: device.publicKeyHash })
    setChallenge(result)
    setStatus('Challenge received')
  }

  async function handleFinishLogin() {
    if (!device || !challenge) return
    setStatus('Signing challenge...')
    const signature = await signEncryptedData(challenge.encryptedData, device.privateKey)
    const result = await api.finishLogin({
      nonce: challenge.nonce,
      encryptedKey: challenge.encryptedKey,
      encryptedData: challenge.encryptedData,
      iv: challenge.iv,
      signature
    })
    setTokens(result)
    setStatus('Authenticated with Keycloak tokens')
    setStep('authenticated')
  }

  async function handleRefresh() {
    if (!tokens) return
    const refreshed = await api.refresh({ refreshToken: tokens.refreshToken })
    setTokens({ ...refreshed, requiredAction: null })
    setStatus('Tokens refreshed')
  }

  async function handleLogout() {
    if (!tokens) return
    await api.logout({ refreshToken: tokens.refreshToken })
    setTokens(null)
    setChallenge(null)
    setStatus('Logged out')
    setStep('login')
  }

  function handleRemoveBinding() {
    clearDeviceBinding()
    setDevice(null)
    setChallenge(null)
    setTokens(null)
    setForm(createInitialForm())
    setStatus('Removed saved device binding from this browser')
    setStep('register')
  }

  return (
    <main className="shell">
      <section className="hero card">
        <p className="eyebrow">Device Login Sandbox</p>
        <h1>Simulate device registration, encrypted challenge login, and token lifecycle.</h1>
        <p className="lede">After login, the app shows raw tokens, decoded claims, refresh, and logout in one place.</p>
      </section>

      <section className="card flow-card">
        <div>
          <h2>Device flow</h2>
          <p>{status}</p>
        </div>

        {device && (
          <div className="stack binding-stack">
            <div className="info-grid">
              <article>
                <strong>User</strong>
                <span>{device.userId}</span>
              </article>
              <article>
                <strong>Device</strong>
                <span>{device.deviceName}</span>
              </article>
              <article>
                <strong>Public key hash</strong>
                <span>{device.publicKeyHash}</span>
              </article>
            </div>
            <div className="binding-notice" role="note" aria-label="Local device binding notice">
              <strong>Saved in this browser</strong>
              <p className="binding-note">The device binding and its private key are stored in this browser's local storage so login still works after a reload.</p>
              <p className="binding-note">Use Remove saved device binding on shared or temporary machines to clear the local copy.</p>
            </div>
            <div className="actions">
              <button type="button" className="button-secondary" onClick={handleRemoveBinding}>
                Remove saved device binding
              </button>
            </div>
          </div>
        )}

        {step === 'register' && (
          <form className="grid" onSubmit={handleRegister}>
            <label>
              User ID
              <input value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} />
            </label>
            <label>
              Device name
              <input value={form.deviceName} onChange={(event) => setForm({ ...form, deviceName: event.target.value })} />
            </label>
            <label>
              Activation code
              <input value={form.activationCode} onChange={(event) => setForm({ ...form, activationCode: event.target.value })} />
            </label>
            <button type="submit">Register device</button>
          </form>
        )}

        {step === 'password' && (
          <form className="grid" onSubmit={handlePassword}>
            <label>
              Initial password
              <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            </label>
            <button type="submit">Set password</button>
          </form>
        )}

        {(step === 'login' || step === 'authenticated') && device && (
          <div className="stack">
            <div className="actions">
              <button onClick={handleStartLogin}>Start login</button>
              <button onClick={handleFinishLogin} disabled={!challenge}>Finish login</button>
              <button onClick={handleRefresh} disabled={!tokens}>Refresh</button>
              <button onClick={handleLogout} disabled={!tokens}>Logout</button>
            </div>
          </div>
        )}
      </section>

      <section className="card token-card">
        <h2>Tokens and claims</h2>
        {!tokens && <p>No Keycloak tokens yet.</p>}
        {tokens && (
          <>
            <ClaimHighlights accessClaims={accessClaims} idClaims={idClaims} />
            <div className="token-grid">
              <TokenPanel title="Access token" token={tokens.accessToken} claims={accessClaims} />
              <TokenPanel title="ID token" token={tokens.idToken} claims={idClaims} />
              <TokenPanel title="Refresh token" token={tokens.refreshToken} claims={null} />
            </div>
          </>
        )}
      </section>
    </main>
  )
}

function ClaimHighlights({ accessClaims, idClaims }: { accessClaims: ClaimRecord | null; idClaims: ClaimRecord | null }) {
  const username = readString(accessClaims, 'preferred_username') ?? readString(idClaims, 'preferred_username') ?? 'Unavailable'
  const userId = readString(accessClaims, 'userId') ?? readString(idClaims, 'userId') ?? username
  const subject = readString(accessClaims, 'sub') ?? readString(idClaims, 'sub') ?? 'Unavailable'
  const expiresAt = formatExpiry(readNumber(accessClaims, 'exp') ?? readNumber(idClaims, 'exp'))
  const roles = extractRoles(accessClaims)

  return (
    <section className="claim-summary" aria-label="Token claim summary">
      <article>
        <span>User ID</span>
        <strong>{userId}</strong>
      </article>
      <article>
        <span>Username</span>
        <strong>{username}</strong>
      </article>
      <article>
        <span>Subject</span>
        <strong>{subject}</strong>
      </article>
      <article>
        <span>Roles</span>
        <strong>{roles.length ? roles.join(', ') : 'No roles'}</strong>
      </article>
      <article>
        <span>Expires</span>
        <strong>{expiresAt}</strong>
      </article>
    </section>
  )
}

function TokenPanel({ title, token, claims }: { title: string; token: string; claims: ClaimRecord | null }) {
  return (
    <article className="token-panel">
      <h3>{title}</h3>
      <textarea value={token} readOnly rows={8} />
      {claims && <pre>{JSON.stringify(claims, null, 2)}</pre>}
    </article>
  )
}

function readString(claims: ClaimRecord | null, key: string) {
  const value = claims?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(claims: ClaimRecord | null, key: string) {
  const value = claims?.[key]
  return typeof value === 'number' ? value : null
}

function formatExpiry(exp: number | null) {
  if (!exp) {
    return 'Unavailable'
  }

  return new Date(exp * 1000).toLocaleString()
}

function extractRoles(claims: ClaimRecord | null) {
  if (!claims) {
    return []
  }

  const roles = new Set<string>()
  const realmAccess = claims.realm_access

  if (isRecord(realmAccess) && Array.isArray(realmAccess.roles)) {
    for (const role of realmAccess.roles) {
      if (typeof role === 'string' && role.length > 0) {
        roles.add(role)
      }
    }
  }

  const resourceAccess = claims.resource_access

  if (isRecord(resourceAccess)) {
    for (const client of Object.values(resourceAccess)) {
      if (isRecord(client) && Array.isArray(client.roles)) {
        for (const role of client.roles) {
          if (typeof role === 'string' && role.length > 0) {
            roles.add(role)
          }
        }
      }
    }
  }

  return [...roles]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

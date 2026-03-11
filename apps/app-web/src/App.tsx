import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import type { FinishLoginResponse, StartLoginResponse } from '@auth-sandbox-2/shared-types'

import { api } from './api'
import { createSigningKeys, signEncryptedData } from './crypto'

type DeviceState = {
  userId: string
  deviceName: string
  publicKey: string
  publicKeyHash: string
  privateKey: CryptoKey
}

type Step = 'register' | 'password' | 'login' | 'authenticated'

export function App() {
  const [step, setStep] = useState<Step>('register')
  const [status, setStatus] = useState<string>('Ready')
  const [device, setDevice] = useState<DeviceState | null>(null)
  const [challenge, setChallenge] = useState<StartLoginResponse | null>(null)
  const [tokens, setTokens] = useState<FinishLoginResponse | null>(null)
  const [form, setForm] = useState({
    userId: 'demo-user',
    deviceName: 'Browser Device',
    activationCode: '',
    password: 'ChangeMe123!'
  })

  const accessClaims = useMemo(() => tokens?.accessTokenClaims ?? null, [tokens])
  const idClaims = useMemo(() => tokens?.idTokenClaims ?? null, [tokens])

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

    setDevice({
      userId: form.userId,
      deviceName: result.deviceName,
      publicKey: signingKeys.publicKey,
      publicKeyHash: result.publicKeyHash,
      privateKey: signingKeys.privateKey
    })
    setStatus(`Device registered: ${result.deviceName}`)
    setStep(result.passwordRequired ? 'password' : 'login')
  }

  async function handlePassword(event: FormEvent) {
    event.preventDefault()
    if (!device) return
    setStatus('Setting password in backend...')
    await api.setPassword({ userId: device.userId, password: form.password })
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
          <div className="token-grid">
            <TokenPanel title="Access token" token={tokens.accessToken} claims={accessClaims} />
            <TokenPanel title="ID token" token={tokens.idToken} claims={idClaims} />
            <TokenPanel title="Refresh token" token={tokens.refreshToken} claims={null} />
          </div>
        )}
      </section>
    </main>
  )
}

function TokenPanel({ title, token, claims }: { title: string; token: string; claims: Record<string, unknown> | null }) {
  return (
    <article className="token-panel">
      <h3>{title}</h3>
      <textarea value={token} readOnly rows={8} />
      {claims && <pre>{JSON.stringify(claims, null, 2)}</pre>}
    </article>
  )
}

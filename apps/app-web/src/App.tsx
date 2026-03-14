import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import type {
  FinishLoginResponse,
  MockApiMessageRecord,
  MockApiProfileResponse,
  StartLoginResponse
} from '@auth-sandbox-2/shared-types'

import { ApiError, api } from './api'
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

type TraceState = {
  traceId: string
  sessionId: string
}

type MockApiState = {
  profile: MockApiProfileResponse | null
  messages: MockApiMessageRecord[]
  draft: string
  status: string
}

type ClaimRow = {
  key: string
  primaryValue: string
  secondaryValue?: string
  structured?: boolean
  compact?: boolean
  missing?: boolean
}

type SecurePrompt = {
  kind: 'register' | 'login'
  title: string
  body: string
  caption: string
  confirmLabel: string
}

const DEVICE_BINDING_STORAGE_KEY = 'auth-sandbox-2.device-binding'
const TIMESTAMP_CLAIM_KEYS = new Set(['auth_time', 'exp', 'iat', 'nbf'])
const PRIORITY_CLAIM_KEYS = ['sub', 'preferred_username', 'userId', 'scope', 'azp', 'aud', 'iss', 'auth_time', 'iat', 'nbf', 'exp']

function createInitialForm() {
  return {
    userId: 'demo-user',
    deviceName: 'My Phone',
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
  const [busy, setBusy] = useState(false)
  const [device, setDevice] = useState<DeviceState | null>(null)
  const [challenge, setChallenge] = useState<StartLoginResponse | null>(null)
  const [tokens, setTokens] = useState<FinishLoginResponse | null>(null)
  const [securePrompt, setSecurePrompt] = useState<SecurePrompt | null>(null)
  const [form, setForm] = useState(createInitialForm)
  const [traceState, setTraceState] = useState<TraceState | null>(null)
  const [mockApi, setMockApi] = useState<MockApiState>({
    profile: null,
    messages: [],
    draft: 'A fresh protected note from app-web.',
    status: 'Waiting for an authenticated session'
  })

  const accessClaims = useMemo<ClaimRecord | null>(() => tokens?.accessTokenClaims ?? null, [tokens])
  const idClaims = useMemo<ClaimRecord | null>(() => tokens?.idTokenClaims ?? null, [tokens])
  const userInfo = useMemo<ClaimRecord | null>(() => tokens?.userInfo ?? null, [tokens])
  const tokenIntrospection = useMemo<ClaimRecord | null>(() => tokens?.tokenIntrospection ?? null, [tokens])
  const sharedTokenClaimKeys = useMemo(() => buildSharedClaimKeys(accessClaims, idClaims), [accessClaims, idClaims])
  const challengeExpiresAt = useMemo(() => (challenge ? formatDateTime(challenge.expiresAt) : null), [challenge])
  const tokenLifetimeLabel = useMemo(() => (tokens ? formatLifetime(tokens.expiresIn) : null), [tokens])

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
        setStatus('This phone is ready to sign in')
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

  function resetDeviceFlow(statusMessage: string, nextForm?: Partial<ReturnType<typeof createInitialForm>>) {
    clearDeviceBinding()
    setDevice(null)
    setChallenge(null)
    setTokens(null)
    setSecurePrompt(null)
    setTraceState(null)
    setMockApi({
      profile: null,
      messages: [],
      draft: 'A fresh protected note from app-web.',
      status: 'Waiting for an authenticated session'
    })
    setForm({
      ...createInitialForm(),
      ...nextForm
    })
    setStatus(statusMessage)
    setStep('register')
  }

  useEffect(() => {
    if (!tokens) {
      setMockApi((current) => ({
        ...current,
        profile: null,
        messages: [],
        status: device ? 'Sign in to load protected mock data' : 'Waiting for an authenticated session'
      }))
      return
    }

    void runAction(async () => {
      await syncMockApi('Protected mock API synchronized')
    })
  }, [tokens?.accessToken])

  async function runAction(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      setStatus(readErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function createFlowTrace(operation: string, artifacts?: Array<{ name: string; value: unknown; encoding?: string; contentType?: string }>) {
    const nextTrace = {
      traceId: crypto.randomUUID(),
      sessionId: crypto.randomUUID()
    }

    setTraceState(nextTrace)

    await api.sendClientEvent(
      {
        traceId: nextTrace.traceId,
        traceType: operation,
        actorName: 'web-client',
        operation,
        status: 'success',
        timestamp: new Date().toISOString(),
        userId: device?.userId ?? form.userId,
        deviceId: device?.publicKeyHash ?? null,
        sessionId: nextTrace.sessionId,
        artifacts: artifacts?.map((artifact) => ({
          artifactType: 'event_payload',
          name: artifact.name,
          contentType: artifact.contentType ?? 'application/json',
          encoding: artifact.encoding ?? 'json',
          direction: 'outbound',
          rawValue: typeof artifact.value === 'string' ? artifact.value : JSON.stringify(artifact.value, null, 2),
          explanation: 'Client-side event payload captured by the demo trace explorer.'
        }))
      },
      {
        traceId: nextTrace.traceId,
        sessionId: nextTrace.sessionId
      }
    )

    return nextTrace
  }

  async function sendFlowEvent(
    flow: { traceId: string; sessionId: string },
    operation: string,
    artifacts?: Array<{ name: string; value: unknown; encoding?: string; contentType?: string }>
  ) {
    await api.sendClientEvent(
      {
        traceId: flow.traceId,
        traceType: operation.startsWith('device_login') ? 'device_login_finish' : operation,
        actorName: 'web-client',
        operation,
        status: 'success',
        timestamp: new Date().toISOString(),
        userId: device?.userId ?? form.userId,
        deviceId: device?.publicKeyHash ?? null,
        sessionId: flow.sessionId,
        artifacts: artifacts?.map((artifact) => ({
          artifactType: 'event_payload',
          name: artifact.name,
          contentType: artifact.contentType ?? 'application/json',
          encoding: artifact.encoding ?? 'json',
          direction: 'outbound',
          rawValue: typeof artifact.value === 'string' ? artifact.value : JSON.stringify(artifact.value, null, 2),
          explanation: 'Client-side event payload captured by the demo trace explorer.'
        }))
      },
      {
        traceId: flow.traceId,
        sessionId: flow.sessionId
      }
    )
  }

  async function syncMockApi(nextStatus: string) {
    if (!tokens) {
      return
    }

    setMockApi((current) => ({
      ...current,
      status: 'Loading protected mock data...'
    }))

    const flow = await createFlowTrace('mock_api_sync_started', [{
      name: 'mock_api_request',
      value: {
        audience: 'mock-api',
        operation: 'profile_and_messages'
      }
    }])

    try {
      setStatus('Loading protected mock data...')
      const [profile, messages] = await Promise.all([
        api.getMockProfile(tokens.accessToken, flow),
        api.listMockMessages(tokens.accessToken, flow)
      ])
      await sendFlowEvent(flow, 'mock_api_sync_finished', [{
        name: 'mock_api_result',
        value: {
          audience: profile.audience,
          messageCount: messages.items.length,
          username: profile.username
        }
      }])
      setMockApi((current) => ({
        ...current,
        profile,
        messages: messages.items,
        status: `Loaded ${messages.items.length} protected mock records`
      }))
      setStatus(nextStatus)
    } catch (error) {
      setMockApi((current) => ({
        ...current,
        status: readErrorMessage(error)
      }))
      throw error
    } finally {
      setTraceState(null)
    }
  }

  async function handleCreateMockMessage(event: FormEvent) {
    event.preventDefault()
    if (!tokens) {
      return
    }

    await runAction(async () => {
      const text = mockApi.draft.trim()
      if (!text) {
        setMockApi((current) => ({
          ...current,
          status: 'Enter a note before sending it to mock-api'
        }))
        setStatus('Enter a note before sending it to mock-api')
        return
      }

      const flow = await createFlowTrace('mock_api_message_create_started', [{
        name: 'mock_api_message',
        value: { text }
      }])

      try {
        setStatus('Sending note to protected mock-api...')
        const created = await api.createMockMessage(tokens.accessToken, { text }, flow)
        const messages = await api.listMockMessages(tokens.accessToken, flow)
        await sendFlowEvent(flow, 'mock_api_message_create_finished', [{
          name: 'mock_api_message_result',
          value: {
            id: created.item.id,
            messageCount: messages.items.length
          }
        }])
        setMockApi((current) => ({
          ...current,
          messages: messages.items,
          draft: '',
          status: 'mock-api accepted the new protected note'
        }))
        setStatus('mock-api accepted the new protected note')
      } catch (error) {
        setMockApi((current) => ({
          ...current,
          status: readErrorMessage(error)
        }))
        throw error
      } finally {
        setTraceState(null)
      }
    })
  }

  async function requestLoginChallenge(nextStatus: string) {
    if (!device) {
      return
    }

    setStatus('Requesting encrypted challenge...')
    const flow = traceState ?? await createFlowTrace('device_login_started', [{ name: 'device_binding', value: { publicKeyHash: device.publicKeyHash, userId: device.userId } }])
    let result: StartLoginResponse

    try {
      result = await api.startLogin({ publicKeyHash: device.publicKeyHash }, flow)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        resetDeviceFlow('Saved device binding was invalid and has been cleared', {
          userId: device.userId,
          deviceName: device.deviceName
        })
        return
      }

      throw error
    }

    setChallenge(result)
    setStep('login')
    setSecurePrompt({
      kind: 'login',
      title: 'Verify it\'s you',
      body: 'Use your screen lock to continue with this device sign-in.',
      caption: `Challenge ready until ${formatDateTime(result.expiresAt)}`,
      confirmLabel: 'Use screen lock'
    })
    setStatus(nextStatus)
  }

  async function completeRegister() {
    const flow = await createFlowTrace('device_registration_started', [{ name: 'registration_form', value: form }])
    setStatus('Preparing secure device key...')
    const signingKeys = await createSigningKeys()
    setStatus('Saving device binding...')
    const result = await api.registerDevice({
      userId: form.userId,
      deviceName: form.deviceName,
      activationCode: form.activationCode,
      publicKey: signingKeys.publicKey
    }, flow)

    const nextDevice = {
      userId: form.userId,
      deviceName: result.deviceName,
      publicKey: signingKeys.publicKey,
      publicKeyHash: result.publicKeyHash,
      privateKey: signingKeys.privateKey
    }

    setDevice(nextDevice)
    setChallenge(null)
    setTokens(null)
    await persistDeviceBinding(nextDevice, result.passwordRequired)

    if (result.passwordRequired) {
      setStatus('Device binding saved. Create a new Keycloak password to continue.')
      setStep('password')
      return
    }

      await requestLoginChallenge('Approve keychain access to finish sign-in')
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault()
    setSecurePrompt({
      kind: 'register',
      title: 'Verify it\'s you',
      body: 'Use your screen lock to save this device binding in Android Keystore.',
      caption: 'Security check required',
      confirmLabel: 'Use screen lock'
    })
  }

  async function handlePassword(event: FormEvent) {
    event.preventDefault()
    if (!device) return
    await runAction(async () => {
      const flow = traceState ?? await createFlowTrace('device_password_setup', [{ name: 'password_request', value: { userId: device.userId, password: form.password } }])
      setStatus('Saving Keycloak password...')
      await api.setPassword({ userId: device.userId, password: form.password }, flow)
      await persistDeviceBinding(device, false)
      await requestLoginChallenge('Approve keychain access to finish automatic sign-in')
    })
  }

  async function handleStartLogin() {
    if (!device) return
    await runAction(async () => {
      await requestLoginChallenge('Approve keychain access to sign in')
    })
  }

  async function handleFinishLogin() {
    if (!device || !challenge) return
    await runAction(async () => {
      const flow = traceState ?? await createFlowTrace('device_login_finish_started', [{ name: 'challenge_payload', value: challenge }])
      setStatus('Using Secure Element...')
      const signature = await signEncryptedData(challenge.encryptedData, device.privateKey)
      const result = await api.finishLogin({
        nonce: challenge.nonce,
        encryptedKey: challenge.encryptedKey,
        encryptedData: challenge.encryptedData,
        iv: challenge.iv,
        signature
      }, flow)
      await sendFlowEvent(flow, 'device_login_finished', [{ name: 'token_bundle', value: {
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
        scope: result.scope
      } }])
      setTraceState(null)
      setTokens(result)
      setChallenge(null)
      setStatus('Signed in')
      setStep('authenticated')
    })
  }

  async function handleRefresh() {
    if (!tokens) return
    await runAction(async () => {
      const flow = traceState ?? await createFlowTrace('device_token_refresh_started', [{ name: 'refresh_token', value: tokens.refreshToken, encoding: 'jwt', contentType: 'application/jwt' }])
      const refreshed = await api.refresh({ refreshToken: tokens.refreshToken }, flow)
      await sendFlowEvent(flow, 'device_token_refresh_finished', [{ name: 'refresh_result', value: {
        tokenType: refreshed.tokenType,
        expiresIn: refreshed.expiresIn,
        scope: refreshed.scope
      } }])
      setTraceState(null)
      setTokens({ ...refreshed, requiredAction: null })
      setStatus('Tokens refreshed')
    })
  }

  async function handleLogout() {
    if (!tokens) return
    await runAction(async () => {
      const flow = traceState ?? await createFlowTrace('device_logout_started', [{ name: 'refresh_token', value: tokens.refreshToken, encoding: 'jwt', contentType: 'application/jwt' }])
      await api.logout({ refreshToken: tokens.refreshToken }, flow)
      await sendFlowEvent(flow, 'device_logout_finished')
      setTraceState(null)
      setTokens(null)
      setChallenge(null)
      setMockApi((current) => ({
        ...current,
        profile: null,
        messages: [],
        status: 'Sign in to load protected mock data'
      }))
      setStatus('Signed out. This phone is still ready to sign in again.')
      setStep('login')
    })
  }

  async function handleConfirmSecurePrompt() {
    if (!securePrompt) {
      return
    }

    const kind = securePrompt.kind
    setSecurePrompt(null)

    if (kind === 'register') {
      await runAction(async () => {
        await completeRegister()
      })
      return
    }

    await handleFinishLogin()
  }

  function handleCancelSecurePrompt() {
    setSecurePrompt(null)
    setStatus('Biometric prompt closed')
  }

  function handleRemoveBinding() {
    resetDeviceFlow('Device binding removed from this phone')
  }

  return (
    <main className="shell">
      <section className="phone-shell">
        <div className="phone-frame">
          <div className="status-bar" aria-hidden="true">
            <span>9:41</span>
            <div className="status-icons">
              <span />
              <span />
              <span />
            </div>
          </div>

          <section className="app-shell">
            <header className="hero card hero-card">
              <p className="eyebrow">Android Device Pass</p>
              <h1>{tokens ? 'Session tokens' : device ? 'This phone is ready' : 'Set up this phone'}</h1>
              <p className="lede">
              {tokens
                  ? 'Your Keycloak session is live on this phone.'
                  : device
                    ? 'Use the saved device binding to sign in again with Android security.'
                    : 'Enter your activation code and save this phone in Android Keystore.'}
              </p>
            </header>

            <section className="status-card card" aria-live="polite">
              <p className="section-label">Status</p>
              <strong>{status}</strong>
              <div className="status-strip" aria-label="Android security status">
                <span className="status-pill">Keystore ready</span>
                <span className="status-pill">Device bound</span>
              </div>
              <p className="muted-copy">
                {tokens
                  ? `Session active for ${tokenLifetimeLabel ?? 'a limited time'}.`
                  : challengeExpiresAt
                    ? `Secure login request ready until ${challengeExpiresAt}.`
                    : device
                      ? 'The device binding is saved on this phone.'
                      : 'No device binding is saved yet.'}
              </p>
            </section>

            <section className="card flow-card">
              {step === 'register' && (
                <>
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Registration</p>
                      <h2>Set up device sign-in</h2>
                    </div>
                  </div>
                  <div className="android-intro">
                    <strong>Use the activation code from your admin flow.</strong>
                    <p className="muted-copy">After setup, Android security keeps the device binding ready for one-tap sign-in.</p>
                  </div>
                  <form className="grid form-stack" onSubmit={handleRegister}>
                    <label>
                      <span className="field-label">User ID</span>
                      <input value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} disabled={busy} />
                    </label>
                    <label>
                      <span className="field-label">Device name</span>
                      <input value={form.deviceName} onChange={(event) => setForm({ ...form, deviceName: event.target.value })} disabled={busy} />
                    </label>
                    <label>
                      <span className="field-label">Activation code</span>
                      <input value={form.activationCode} onChange={(event) => setForm({ ...form, activationCode: event.target.value })} disabled={busy} />
                    </label>
                    <button type="submit" disabled={busy}>Continue</button>
                  </form>
                </>
              )}

              {step === 'password' && (
                <>
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Password</p>
                      <h2>Create your new password</h2>
                    </div>
                  </div>
                  <p className="muted-copy">This account needs a fresh Keycloak password before Android can finish sign-in.</p>
                  <form className="grid form-stack" onSubmit={handlePassword}>
                    <label>
                      <span className="field-label">New password</span>
                      <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} disabled={busy} />
                    </label>
                    <button type="submit" disabled={busy}>Save password</button>
                  </form>
                </>
              )}

              {step === 'login' && device && (
                <>
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Login</p>
                      <h2>Sign in with saved device</h2>
                    </div>
                  </div>
                  <div className="challenge-card">
                    <p className="section-label">Android security</p>
                    <strong>{challenge ? 'Ready for verification' : 'Saved device sign-in is ready'}</strong>
                    <p className="muted-copy">
                      {challenge
                        ? 'Verify with your screen lock to finish sign-in.'
                        : 'The app requests a challenge and then opens one Android verification prompt.'}
                    </p>
                  </div>
                  <div className="binding-stack">
                    <div className="device-summary" aria-label="Saved device summary">
                      <div>
                        <span className="field-label">Account</span>
                        <strong>{device.userId}</strong>
                      </div>
                      <div>
                        <span className="field-label">Device</span>
                        <strong>{device.deviceName}</strong>
                      </div>
                    </div>
                    <div className="binding-notice" role="note" aria-label="Local device binding notice">
                      <strong>Saved on this phone</strong>
                      <p className="binding-note">The private key stays on this device so sign-in still works after logout or reload.</p>
                    </div>
                    <details className="device-details">
                      <summary>Device details</summary>
                      <p>{device.publicKeyHash}</p>
                    </details>
                    <div className="actions stacked-actions">
                      <button type="button" onClick={handleStartLogin} disabled={busy}>Continue with device</button>
                      <button type="button" className="button-secondary" onClick={handleRemoveBinding} disabled={busy}>Remove device binding</button>
                    </div>
                  </div>
                </>
              )}

              {step === 'authenticated' && tokens && device && (
                <>
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Signed in</p>
                      <h2>{device.deviceName}</h2>
                    </div>
                  </div>
                  <section className="token-overview" aria-label="Token overview cards">
                    <article>
                      <span>Access</span>
                      <strong>Granted</strong>
                      <p>API access for this device session.</p>
                    </article>
                    <article>
                      <span>ID</span>
                      <strong>Ready</strong>
                      <p>User identity for the signed-in session.</p>
                    </article>
                    <article>
                      <span>Refresh</span>
                      <strong>Stored</strong>
                      <p>Use refresh to get a fresh token set.</p>
                    </article>
                  </section>
                  <div className="challenge-card authenticated-card">
                    <p className="section-label">Android device</p>
                    <strong>Signed in and ready</strong>
                    <p className="muted-copy">Refresh gets a fresh token bundle. Sign out keeps the device binding so device login stays one tap away.</p>
                  </div>
                  <div className="actions stacked-actions">
                    <button type="button" onClick={handleRefresh} disabled={busy}>Refresh tokens</button>
                    <button type="button" className="button-secondary" onClick={handleLogout} disabled={busy}>Sign out</button>
                  </div>
                  <section className="challenge-card mock-api-card" aria-label="Protected mock API panel">
                    <p className="section-label">Mock API</p>
                    <strong>OIDC token protected demo endpoints</strong>
                    <p className="muted-copy">The app calls `mock-api` with the current access token. The backend validates JWKS signatures and the `mock-api` audience before serving data.</p>
                    <div className="device-summary mock-api-summary">
                      <div>
                        <span className="field-label">Audience</span>
                        <strong>{mockApi.profile?.audience.join(', ') ?? 'Not loaded'}</strong>
                      </div>
                      <div>
                        <span className="field-label">Username</span>
                        <strong>{mockApi.profile?.username ?? 'Not loaded'}</strong>
                      </div>
                      <div>
                        <span className="field-label">Client</span>
                        <strong>{mockApi.profile?.clientId ?? 'Not loaded'}</strong>
                      </div>
                      <div>
                        <span className="field-label">Scope</span>
                        <strong>{mockApi.profile?.scope.join(', ') ?? 'Not loaded'}</strong>
                      </div>
                    </div>
                    <p className="mock-api-status">{mockApi.status}</p>
                    <div className="actions stacked-actions">
                      <button type="button" onClick={() => void runAction(async () => { await syncMockApi('Protected mock API synchronized') })} disabled={busy}>Reload mock API</button>
                    </div>
                    <form className="grid form-stack" onSubmit={handleCreateMockMessage}>
                      <label>
                        <span className="field-label">New protected note</span>
                        <textarea value={mockApi.draft} onChange={(event) => setMockApi((current) => ({ ...current, draft: event.target.value }))} disabled={busy} rows={4} />
                      </label>
                      <button type="submit" disabled={busy}>Post note to mock-api</button>
                    </form>
                    <div className="message-list" aria-label="Protected mock API messages">
                      {mockApi.messages.map((message) => (
                        <article key={message.id} className="message-item">
                          <div className="message-meta">
                            <span>{message.category}</span>
                            <span>{formatDateTime(message.createdAt)}</span>
                          </div>
                          <strong>{message.authorUserId}</strong>
                          <p>{message.text}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </section>

            <section className="card token-card">
              <div className="section-heading simple-heading">
                <div>
                  <p className="section-label">Session details</p>
                  <h2>Tokens</h2>
                </div>
              </div>

              {!tokens && <TokenEmptyState hasDevice={Boolean(device)} hasChallenge={Boolean(challenge)} />}

              {tokens && (
                <>
                  <TokenHero tokens={tokens} tokenLifetimeLabel={tokenLifetimeLabel} />
                  <ClaimHighlights accessClaims={accessClaims} idClaims={idClaims} />
                  <div className="token-grid">
                    <TokenComparisonPanel
                      accessToken={tokens.accessToken}
                      accessClaims={accessClaims}
                      idToken={tokens.idToken}
                      idClaims={idClaims}
                      claimKeys={sharedTokenClaimKeys}
                    />
                    <JsonPanel title="Userinfo endpoint" payload={userInfo} rawLabel="Userinfo response JSON" />
                    <JsonPanel title="Introspection endpoint" payload={tokenIntrospection} rawLabel="Introspection response JSON" />
                    <TokenPanel title="Refresh token" token={tokens.refreshToken} rawLabel="Refresh token JWT" claims={null} />
                  </div>
                </>
              )}
            </section>
          </section>
        </div>

        {securePrompt && (
          <SecureElementPrompt
            prompt={securePrompt}
            busy={busy}
            onConfirm={handleConfirmSecurePrompt}
            onCancel={handleCancelSecurePrompt}
          />
        )}
      </section>
    </main>
  )
}

function TokenEmptyState({ hasDevice, hasChallenge }: { hasDevice: boolean; hasChallenge: boolean }) {
  return (
    <section className="token-empty" aria-label="Token wallet empty state">
      <div>
        <p className="section-label">Locked</p>
        <h3>Tokens appear here after device login.</h3>
      </div>
      <p className="muted-copy">
        {hasChallenge
          ? 'Confirm the secure login prompt to unlock the token screen.'
          : hasDevice
            ? 'This phone already has a saved device binding.'
            : 'Bind this phone first with an activation code.'}
      </p>
      <p>No Keycloak tokens yet.</p>
    </section>
  )
}

function SecureElementPrompt(props: {
  prompt: SecurePrompt
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="prompt-backdrop">
      <section className="prompt-sheet" aria-label="Secure element prompt">
        <div className="prompt-icon" aria-hidden="true">◎</div>
        <p className="section-label">Android Security</p>
        <h3>{props.prompt.title}</h3>
        <p className="muted-copy">{props.prompt.body}</p>
        <p className="prompt-caption">{props.prompt.caption}</p>
        <div className="prompt-helper">
          <span className="prompt-helper-dot" aria-hidden="true" />
          <p>Use fingerprint, face unlock, or device PIN from Android system security.</p>
        </div>

        <div className="actions stacked-actions">
          <button type="button" onClick={props.onConfirm} disabled={props.busy}>{props.prompt.confirmLabel}</button>
          <button type="button" className="button-secondary" onClick={props.onCancel} disabled={props.busy}>Cancel</button>
        </div>
      </section>
    </div>
  )
}

function TokenHero({ tokens, tokenLifetimeLabel }: { tokens: FinishLoginResponse; tokenLifetimeLabel: string | null }) {
  return (
    <section className="token-hero" aria-label="Authenticated token summary">
      <article>
        <span>Token type</span>
        <strong>{tokens.tokenType}</strong>
      </article>
      <article>
        <span>Scope</span>
        <strong>{tokens.scope || 'Unavailable'}</strong>
      </article>
      <article>
        <span>Expires in</span>
        <strong>{tokenLifetimeLabel ?? `${tokens.expiresIn} seconds`}</strong>
      </article>
    </section>
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
        <span>Session ID</span>
        <strong>{subject}</strong>
      </article>
      <article>
        <span>Roles</span>
        <strong>{roles.length ? roles.join(', ') : 'No roles'}</strong>
      </article>
      <article>
        <span>Ends</span>
        <strong>{expiresAt}</strong>
      </article>
    </section>
  )
}

function TokenComparisonPanel(props: {
  accessToken: string
  accessClaims: ClaimRecord | null
  idToken: string
  idClaims: ClaimRecord | null
  claimKeys: string[]
}) {
  return (
    <article className="token-panel token-panel-comparison">
      <h3>Access and ID tokens</h3>
      <p className="muted-copy">Live JWT values for the active Android session. Open decoded details for the full claim view.</p>
      <div className="raw-token-grid">
        <details className="token-raw" open>
          <summary>Access token JWT</summary>
          <textarea value={props.accessToken} readOnly rows={8} />
        </details>
        <details className="token-raw" open>
          <summary>ID token JWT</summary>
          <textarea value={props.idToken} readOnly rows={8} />
        </details>
      </div>
      <details className="token-details">
        <summary>Decoded token details</summary>
        {props.accessClaims && props.idClaims ? (
          <TokenComparisonTable accessClaims={props.accessClaims} idClaims={props.idClaims} claimKeys={props.claimKeys} />
        ) : (
          <p className="muted-copy">Decoded claims are unavailable.</p>
        )}
      </details>
    </article>
  )
}

function TokenPanel({ title, token, rawLabel, claims }: { title: string; token: string; rawLabel: string; claims: ClaimRecord | null }) {
  return (
    <article className="token-panel">
      <h3>{title}</h3>
      {claims ? <ClaimsTable title={title} claims={claims} /> : <p className="muted-copy">No decoded claims available for this token.</p>}
      <details className="token-raw">
        <summary>{rawLabel}</summary>
        <textarea value={token} readOnly rows={8} />
      </details>
    </article>
  )
}

function JsonPanel({ title, payload, rawLabel }: { title: string; payload: ClaimRecord | null; rawLabel: string }) {
  const summaryItems = title === 'Userinfo endpoint'
    ? buildUserInfoSummary(payload)
    : buildIntrospectionSummary(payload)

  return (
    <article className="token-panel">
      <h3>{title}</h3>
      {payload ? (
        <>
          <section className="endpoint-summary" aria-label={`${title} summary`}>
            {summaryItems.map((item) => (
              <article key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </section>
          <ClaimsTable title={title} claims={payload} />
        </>
      ) : <p className="muted-copy">No endpoint response available.</p>}
      <details className="token-raw">
        <summary>{rawLabel}</summary>
        <textarea value={payload ? JSON.stringify(payload, null, 2) : ''} readOnly rows={8} />
      </details>
    </article>
  )
}

function TokenComparisonTable({ accessClaims, idClaims, claimKeys }: { accessClaims: ClaimRecord; idClaims: ClaimRecord; claimKeys: string[] }) {
  const rows = claimKeys.map((key) => ({
    key,
    access: buildClaimCell(accessClaims, key),
    id: buildClaimCell(idClaims, key)
  }))

  return (
    <div className="claims-table-wrap">
      <table className="claims-table claims-table-comparison" aria-label="Access and ID token claims">
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Access token</th>
            <th scope="col">ID token</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.access.compact && row.id.compact ? 'claims-row-compact' : undefined}>
              <th scope="row">{row.key}</th>
              <td>{renderClaimCell(row.access)}</td>
              <td>{renderClaimCell(row.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ClaimsTable({ title, claims }: { title: string; claims: ClaimRecord }) {
  const rows = Object.keys(claims)
    .sort(compareClaimKeys)
    .map((key) => ({
      key,
      cell: buildClaimCell(claims, key)
    }))

  return (
    <div className="claims-table-wrap">
      <table className="claims-table" aria-label={`${title} claims`}>
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.cell.compact ? 'claims-row-compact' : undefined}>
              <th scope="row">{row.key}</th>
              <td>{renderClaimCell(row.cell)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderClaimCell(row: Omit<ClaimRow, 'key'>) {
  if (row.structured) {
    return <pre className="claim-structured">{row.primaryValue}</pre>
  }

  return (
    <div className="claim-value">
      <span className={row.missing ? 'claim-primary claim-missing' : 'claim-primary'}>{row.primaryValue}</span>
      {row.secondaryValue && <span className="claim-secondary">{row.secondaryValue}</span>}
    </div>
  )
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Something went wrong during the device flow'
}

function readString(claims: ClaimRecord | null, key: string) {
  const value = claims?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(claims: ClaimRecord | null, key: string) {
  const value = claims?.[key]
  return typeof value === 'number' ? value : null
}

function buildSharedClaimKeys(accessClaims: ClaimRecord | null, idClaims: ClaimRecord | null) {
  const keys = new Set<string>()

  for (const claims of [accessClaims, idClaims]) {
    if (!claims) {
      continue
    }

    for (const key of Object.keys(claims)) {
      keys.add(key)
    }
  }

  return [...keys].sort(compareClaimKeys)
}

function buildClaimCell(claims: ClaimRecord, key: string): Omit<ClaimRow, 'key'> {
  if (!(key in claims)) {
    return {
      primaryValue: '—',
      compact: true,
      missing: true
    }
  }

  return formatClaimValue(key, claims[key])
}

function formatClaimValue(key: string, value: unknown) {
  if (typeof value === 'number' && TIMESTAMP_CLAIM_KEYS.has(key)) {
    return {
      primaryValue: new Date(value * 1000).toLocaleString(),
      secondaryValue: `Unix: ${value}`,
      compact: true
    }
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string' || typeof entry === 'number')) {
    return {
      primaryValue: value.join(', '),
      compact: true
    }
  }

  if (typeof value === 'string' && value.includes('://')) {
    return {
      primaryValue: value,
      compact: true
    }
  }

  if (Array.isArray(value) || isRecord(value)) {
    return {
      primaryValue: JSON.stringify(value, null, 2),
      structured: true
    }
  }

  return {
    primaryValue: stringifyClaimValue(value),
    compact: typeof value !== 'string' || value.length < 72
  }
}

function stringifyClaimValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value)
  }

  return JSON.stringify(value)
}

function compareClaimKeys(left: string, right: string) {
  const leftPriority = PRIORITY_CLAIM_KEYS.indexOf(left)
  const rightPriority = PRIORITY_CLAIM_KEYS.indexOf(right)

  if (leftPriority !== -1 || rightPriority !== -1) {
    if (leftPriority === -1) {
      return 1
    }
    if (rightPriority === -1) {
      return -1
    }
    return leftPriority - rightPriority
  }

  return left.localeCompare(right)
}

function formatExpiry(exp: number | null) {
  if (!exp) {
    return 'Unavailable'
  }

  return new Date(exp * 1000).toLocaleString()
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

function formatLifetime(seconds: number) {
  if (seconds < 60) {
    return `${seconds} sec`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (remainingSeconds === 0) {
    return `${minutes} min`
  }

  return `${minutes} min ${remainingSeconds} sec`
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

function buildUserInfoSummary(payload: ClaimRecord | null) {
  const username = readString(payload, 'preferred_username') ?? 'Unavailable'
  const subject = readString(payload, 'sub') ?? 'Unavailable'
  const fallbackName = [readString(payload, 'given_name'), readString(payload, 'family_name')].filter(Boolean).join(' ')
  const fullName = readString(payload, 'name') ?? (fallbackName || 'Unavailable')
  const emailVerified = readBoolean(payload, 'email_verified')

  return [
    { label: 'Username', value: username },
    { label: 'Subject', value: subject },
    { label: 'Name', value: fullName },
    { label: 'Email verified', value: emailVerified === null ? 'Unavailable' : emailVerified ? 'Yes' : 'No' }
  ]
}

function buildIntrospectionSummary(payload: ClaimRecord | null) {
  const active = readBoolean(payload, 'active')
  const username = readString(payload, 'username') ?? readString(payload, 'preferred_username') ?? 'Unavailable'
  const subject = readString(payload, 'sub') ?? 'Unavailable'
  const scope = readString(payload, 'scope') ?? 'Unavailable'
  const expiresAt = formatExpiry(readNumber(payload, 'exp'))

  return [
    { label: 'Active', value: active === null ? 'Unavailable' : active ? 'Yes' : 'No' },
    { label: 'Username', value: username },
    { label: 'Subject', value: subject },
    { label: 'Expires', value: expiresAt },
    { label: 'Scope', value: scope }
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readBoolean(claims: ClaimRecord | null, key: string) {
  const value = claims?.[key]
  return typeof value === 'boolean' ? value : null
}

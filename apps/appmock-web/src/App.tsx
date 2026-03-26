import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import type {
  AssuranceFlowService,
  AssuranceFlowServiceOption,
  ServiceMockApiMessageRecord,
  ServiceMockApiProfileResponse,
  PublicAssuranceFlowRecord,
  SessionTokenBundle,
  TokenBundle,
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

type Step = 'register' | 'register_verify' | 'password' | 'login' | 'authenticated'

type AuthenticatedTab = 'tokens' | 'servicemock-api'

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

type TraceArtifact = {
  name: string
  value: unknown
  encoding?: string
  contentType?: string
}

type PendingRegistration = {
  flowId: string
  // Flow-scoped bearer for the whole registration/assurance journey.
  flowToken: string
  // Service-scoped bearer for the currently selected identification step.
  serviceToken?: string
  publicKey: string
  privateKey: CryptoKey
  availableServices: AssuranceFlowServiceOption[]
  selectedService: AssuranceFlowService
  // Redacted SMS destination shown back to the user, e.g. ***1234.
  maskedTarget?: string | null
}

type ServiceMockApiState = {
  profile: ServiceMockApiProfileResponse | null
  messages: ServiceMockApiMessageRecord[]
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
    firstName: 'Demo',
    lastName: 'User',
    birthDate: '1990-01-01',
    phoneNumber: '+491701234567',
    deviceName: 'My Phone',
    selectedService: 'person_code' as AssuranceFlowService,
    code: '',
    tan: '',
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
  const [tokens, setTokens] = useState<TokenBundle | null>(null)
  const [securePrompt, setSecurePrompt] = useState<SecurePrompt | null>(null)
  const [form, setForm] = useState(createInitialForm)
  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistration | null>(null)
  const [traceState, setTraceState] = useState<TraceState | null>(null)
  const [activeAuthenticatedTab, setActiveAuthenticatedTab] = useState<AuthenticatedTab>('tokens')
  const [serviceMockApi, setServiceMockApi] = useState<ServiceMockApiState>({
    profile: null,
    messages: [],
    draft: 'A fresh protected note from appmock-web.',
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
          code: '',
          tan: ''
        }))
        setStep(stored.passwordRequired ? 'password' : 'login')
        setStatus('Dieses Gerät ist bereit zur Anmeldung')
      } catch {
        clearDeviceBinding()
        if (!cancelled) {
          setStatus('Gespeicherte Gerätebindung war ungültig und wurde entfernt')
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
    setPendingRegistration(null)
    setTraceState(null)
    setActiveAuthenticatedTab('tokens')
    setServiceMockApi({
      profile: null,
      messages: [],
      draft: 'A fresh protected note from appmock-web.',
        status: 'Warten auf eine authentifizierte Sitzung'
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
      setServiceMockApi((current) => ({
        ...current,
        profile: null,
        messages: [],
        status: device ? 'Anmelden, um geschützte Mock-Daten zu laden' : 'Warten auf eine authentifizierte Sitzung'
      }))
      return
    }

    void runAction(async () => {
      await syncServiceMockApi('Geschützte ServiceMock API synchronisiert')
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

  function buildTraceEvent(
    operation: string,
    trace: { traceId: string; sessionId: string },
    artifacts?: TraceArtifact[]
  ) {
    return {
      traceId: trace.traceId,
      traceType: operation.startsWith('device_login') ? 'device_login_finish' : operation,
      actorName: 'web-client',
      operation,
      status: 'success' as const,
      timestamp: new Date().toISOString(),
      userId: device?.userId ?? form.userId,
      deviceId: device?.publicKeyHash ?? null,
      sessionId: trace.sessionId,
      artifacts: artifacts?.map((artifact) => ({
        artifactType: 'event_payload',
        name: artifact.name,
        contentType: artifact.contentType ?? 'application/json',
        encoding: artifact.encoding ?? 'json',
        direction: 'outbound',
        rawValue: typeof artifact.value === 'string' ? artifact.value : JSON.stringify(artifact.value, null, 2),
        explanation: 'Client-side event payload captured by the demo trace explorer.'
      }))
    }
  }

  async function createFlowTrace(operation: string, artifacts?: TraceArtifact[]) {
    const nextTrace = {
      traceId: crypto.randomUUID(),
      sessionId: crypto.randomUUID()
    }

    setTraceState(nextTrace)

    // Artifacts sent here are emitted only to trace-api/client-events.
    // They are not added to auth-api request bodies unless the caller also
    // sends the same values explicitly in a separate business request.
    await api.sendClientEvent(buildTraceEvent(operation, nextTrace, artifacts), nextTrace)

    return nextTrace
  }

  async function sendFlowEvent(
    flow: { traceId: string; sessionId: string },
    operation: string,
    artifacts?: TraceArtifact[]
  ) {
    // These event artifacts are trace-only telemetry for the demo trace explorer.
    await api.sendClientEvent(buildTraceEvent(operation, flow, artifacts), flow)
  }

  async function syncServiceMockApi(nextStatus: string) {
    if (!tokens) {
      return
    }

    setServiceMockApi((current) => ({
      ...current,
      status: 'Geschützte Mock-Daten werden geladen...'
    }))

    const flow = await createFlowTrace('servicemock_api_sync_started', [{
      // Trace-only request summary; servicemock-api only receives the HTTP calls below.
      name: 'servicemock_api_request',
      value: {
        audience: 'servicemock-api',
        operation: 'profile_and_messages'
      }
    }])

    try {
      setStatus('Geschützte Mock-Daten werden geladen...')
      const [profile, messages] = await Promise.all([
        api.getMockProfile(tokens.accessToken, flow),
        api.listMockMessages(tokens.accessToken, flow)
      ])
      await sendFlowEvent(flow, 'servicemock_api_sync_finished', [{
        // Trace-only aggregate result for observability; this summary is not
        // posted to auth-api or servicemock-api.
        name: 'servicemock_api_result',
        value: {
          audience: profile.audience,
          messageCount: messages.items.length,
          username: profile.username
        }
      }])
      setServiceMockApi((current) => ({
        ...current,
        profile,
        messages: messages.items,
        status: `${messages.items.length} geschützte Mock-Einträge geladen`
      }))
      setStatus(nextStatus)
    } catch (error) {
      setServiceMockApi((current) => ({
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
      const text = serviceMockApi.draft.trim()
      if (!text) {
        setServiceMockApi((current) => ({
          ...current,
          status: 'Gib eine Notiz ein, bevor du sie an servicemock-api sendest'
        }))
        setStatus('Gib eine Notiz ein, bevor du sie an servicemock-api sendest')
        return
      }

      const flow = await createFlowTrace('servicemock_api_message_create_started', [{
        name: 'servicemock_api_message',
        // Trace-only mirror of the note text; the actual servicemock-api write uses
        // its own request body below.
        value: { text }
      }])

      try {
        setStatus('Geschützte Notiz wird an servicemock-api gesendet...')
        const created = await api.createMockMessage(tokens.accessToken, { text }, flow)
        const messages = await api.listMockMessages(tokens.accessToken, flow)
        await sendFlowEvent(flow, 'servicemock_api_message_create_finished', [{
          name: 'servicemock_api_message_result',
          // Trace-only write result summary for the explorer.
          value: {
            id: created.item.id,
            messageCount: messages.items.length
          }
        }])
        setServiceMockApi((current) => ({
          ...current,
          messages: messages.items,
          draft: '',
          status: 'servicemock-api hat die neue geschützte Notiz akzeptiert'
        }))
        setStatus('servicemock-api hat die neue geschützte Notiz akzeptiert')
      } catch (error) {
        setServiceMockApi((current) => ({
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

    setStatus('Verschlüsselte Challenge wird angefordert...')
    const flow = traceState ?? await createFlowTrace('device_login_started', [{
        name: 'device_binding',
        value: {
          publicKeyHash: device.publicKeyHash,
          // Trace-only context for the explorer; /api/device/login/start only
          // receives publicKeyHash.
          userId: device.userId
        }
      }])
    let result: StartLoginResponse

    try {
      result = await api.startLogin({ publicKeyHash: device.publicKeyHash }, flow)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        resetDeviceFlow('Gespeicherte Gerätebindung war ungültig und wurde entfernt', {
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
      title: 'Bestätige deine Identität',
      body: 'Nutze deine Displaysperre, um diese Geräteanmeldung fortzusetzen.',
      caption: `Challenge bereit bis ${formatDateTime(result.expiresAt)}`,
      confirmLabel: 'Displaysperre verwenden'
    })
    setStatus(nextStatus)
  }

  async function finalizeRegistration(result: PublicAssuranceFlowRecord, signingKeys: { publicKey: string; privateKey: CryptoKey }) {
    if (!result.finalization || result.finalization.kind !== 'registration_result') {
      throw new Error('Registration flow did not return a registration result')
    }
    if (!result.finalization.publicKeyHash) {
      throw new Error('Registration flow did not return a public key hash')
    }
    const nextDevice = {
      userId: result.finalization.userId,
      deviceName: form.deviceName,
      publicKey: signingKeys.publicKey,
      publicKeyHash: result.finalization.publicKeyHash,
      privateKey: signingKeys.privateKey
    }

    setDevice(nextDevice)
    setChallenge(null)
    setTokens(null)
    await persistDeviceBinding(nextDevice, result.finalization.passwordSetupRequired)

    if (result.finalization.passwordSetupRequired) {
      setStatus('Gerätebindung gespeichert. Lege ein neues Keycloak-Passwort fest, um fortzufahren.')
      setStep('password')
      setPendingRegistration(null)
      return
    }

    setPendingRegistration(null)
    await requestLoginChallenge('Bestätige den Schlüsselspeicherzugriff, um die Anmeldung abzuschließen')
  }

  async function completeRegister() {
    const flow = await createFlowTrace('device_registration_started', [{
      name: 'registration_form',
      // Trace-only snapshot of the full local form. The createFlow request below
      // forwards only the selected fields needed by auth-api.
      value: form
    }])
    setStatus('Sicherer Geräteschlüssel wird vorbereitet...')
    const signingKeys = await createSigningKeys()
    setStatus('Registrierungs-Flow wird angelegt...')
    const created = await api.createRegistrationFlow({
      userId: form.userId,
      firstName: form.firstName,
      lastName: form.lastName,
      birthDate: form.birthDate,
      phoneNumber: form.phoneNumber,
      deviceName: form.deviceName,
      publicKey: signingKeys.publicKey,
      requiredAcr: 'level_1'
    }, flow)

    if (created.availableServices.length === 0) {
      throw new Error('Für diese Person sind aktuell keine Identifikationsservices vorbereitet')
    }

    const selectedService = created.availableServices.some((service) => service.id === form.selectedService)
      ? form.selectedService
      : created.availableServices[0].id

    setPendingRegistration({
      flowId: created.flowId,
      flowToken: created.flowToken,
      serviceToken: undefined,
      publicKey: signingKeys.publicKey,
      privateKey: signingKeys.privateKey,
      availableServices: created.availableServices,
      selectedService,
      maskedTarget: created.method?.maskedTarget ?? null
    })
    setForm((current) => ({
      ...current,
      selectedService,
      code: '',
      tan: ''
    }))
    setStatus('Wähle einen verfügbaren Identifikationsservice aus und führe ihn aus.')
    setStep('register_verify')
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault()
    setSecurePrompt({
      kind: 'register',
      title: 'Bestätige deine Identität',
      body: 'Nutze deine Displaysperre, um diese Gerätebindung im Android-Keystore zu speichern.',
      caption: 'Sicherheitsprüfung erforderlich',
      confirmLabel: 'Displaysperre verwenden'
    })
  }

  async function handleStartSelectedService() {
    if (!pendingRegistration) {
      return
    }

    const selected = await api.selectFlowService(
      pendingRegistration.flowId,
      pendingRegistration.flowToken,
      { service: form.selectedService },
      traceState ?? undefined
    )
    const serviceToken = selected.serviceToken
    if (!serviceToken) {
      throw new Error('Flow selection did not return a service token')
    }

    const started = form.selectedService === 'sms_tan'
      ? await api.startSmsTan(serviceToken, traceState ?? undefined)
      : { maskedTarget: null }

    setPendingRegistration((current) => current
      ? {
          ...current,
          serviceToken,
          selectedService: form.selectedService,
          maskedTarget: started.maskedTarget ?? current.maskedTarget ?? null
        }
      : current)

    setStatus(form.selectedService === 'sms_tan'
      ? 'Die SMS-TAN wurde gesendet. Gib sie hier ein oder fordere eine neue SMS-TAN an.'
      : 'Gib den vorbereiteten Code ein, um die Registrierung fortzusetzen.')
  }

  async function handleCompleteSelectedService(event: FormEvent) {
    event.preventDefault()
    if (!pendingRegistration) {
      return
    }

    await runAction(async () => {
      if (!pendingRegistration.serviceToken) {
        throw new Error('No service token available. Start the selected service first.')
      }
      const completed = form.selectedService === 'person_code'
        ? await api.completePersonCode(pendingRegistration.serviceToken, form.code, traceState ?? undefined)
        : await api.completeSmsTan(pendingRegistration.serviceToken, form.tan, traceState ?? undefined)
      const finalized = await api.finalizeFlow(
        pendingRegistration.flowId,
        pendingRegistration.flowToken,
        { serviceResultToken: completed.serviceResultToken, channel: 'registration' },
        traceState ?? undefined
      )
      await finalizeRegistration(finalized, {
        publicKey: pendingRegistration.publicKey,
        privateKey: pendingRegistration.privateKey
      })
    })
  }

  async function handleResendTan() {
    if (!pendingRegistration || form.selectedService !== 'sms_tan') {
      return
    }

    await runAction(async () => {
      if (!pendingRegistration.serviceToken) {
        throw new Error('No service token available. Start SMS-TAN first.')
      }
      const restarted = await api.resendSmsTan(pendingRegistration.serviceToken, traceState ?? undefined)
      setPendingRegistration((current) => current
        ? {
            ...current,
            maskedTarget: restarted.maskedTarget ?? current.maskedTarget ?? null
          }
        : current)
      setForm((current) => ({
        ...current,
        tan: ''
      }))
      setStatus('Eine neue SMS-TAN wurde gesendet.')
    })
  }

  async function handlePassword(event: FormEvent) {
    event.preventDefault()
    if (!device) return
    await runAction(async () => {
      const flow = traceState ?? await createFlowTrace('device_password_setup', [{
        name: 'password_request',
        // Trace-only mirror of the password setup payload; the auth-api call
        // below sends its own request body separately.
        value: { userId: device.userId, password: form.password }
      }])
      setStatus('Keycloak-Passwort wird gespeichert...')
      await api.setPassword({ userId: device.userId, password: form.password }, flow)
      await persistDeviceBinding(device, false)
      await requestLoginChallenge('Bestätige den Schlüsselspeicherzugriff, um die automatische Anmeldung abzuschließen')
    })
  }

  async function handleStartLogin() {
    if (!device) return
    await runAction(async () => {
      await requestLoginChallenge('Bestätige den Schlüsselspeicherzugriff zur Anmeldung')
    })
  }

  async function handleFinishLogin() {
    if (!device || !challenge) return
    await runAction(async () => {
      const flow = traceState ?? await createFlowTrace('device_login_finish_started', [{
        name: 'challenge_payload',
        value: challenge
      }])
      setStatus('Secure Element wird verwendet...')
      const signature = await signEncryptedData(challenge.encryptedData, device.privateKey)
      const result = await api.finishLogin({
        nonce: challenge.nonce,
        encryptedKey: challenge.encryptedKey,
        encryptedData: challenge.encryptedData,
        iv: challenge.iv,
        signature
      }, flow)
      await sendFlowEvent(flow, 'device_login_finished', [{
        name: 'token_bundle',
        value: {
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          scope: result.scope
        }
      }])
      setTraceState(null)
      setTokens(result)
      setChallenge(null)
      setActiveAuthenticatedTab('tokens')
      setStatus('Angemeldet')
      setStep('authenticated')
    })
  }

  async function handleRefresh() {
    if (!tokens) return
    await runAction(async () => {
      const flow = traceState ?? await createFlowTrace('device_token_refresh_started', [{
        name: 'refresh_token',
        // Trace-only copy of the refresh token for trace inspection; the
        // refresh request below sends the business payload separately.
        value: tokens.refreshToken,
        encoding: 'jwt',
        contentType: 'application/jwt'
      }])
      const refreshed = await api.refresh({ refreshToken: tokens.refreshToken }, flow)
      await sendFlowEvent(flow, 'device_token_refresh_finished', [{
        name: 'refresh_result',
        value: {
          tokenType: refreshed.tokenType,
          expiresIn: refreshed.expiresIn,
          scope: refreshed.scope
        }
      }])
      setTraceState(null)
      setTokens(refreshed)
      setStatus('Tokens aktualisiert')
    })
  }

  async function handleLogout() {
    if (!tokens) return
    await runAction(async () => {
      const flow = traceState ?? await createFlowTrace('device_logout_started', [{
        name: 'refresh_token',
        // Trace-only copy of the refresh token for trace inspection; the
        // logout request below sends the business payload separately.
        value: tokens.refreshToken,
        encoding: 'jwt',
        contentType: 'application/jwt'
      }])
      await api.logout({ refreshToken: tokens.refreshToken }, flow)
      await sendFlowEvent(flow, 'device_logout_finished')
      setTraceState(null)
      setTokens(null)
      setChallenge(null)
      setActiveAuthenticatedTab('tokens')
      setServiceMockApi((current) => ({
        ...current,
        profile: null,
        messages: [],
        status: 'Anmelden, um geschützte Mock-Daten zu laden'
      }))
      setStatus('Abgemeldet. Dieses Gerät ist weiter für eine neue Anmeldung bereit.')
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
    setStatus('Biometrischer Dialog geschlossen')
  }

  function handleRemoveBinding() {
    resetDeviceFlow('Gerätebindung von diesem Gerät entfernt')
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
              <h1>{tokens ? 'Aktive Sitzung' : device ? 'Dieses Telefon ist bereit' : 'Dieses Telefon einrichten'}</h1>
              <p className="lede">
              {tokens
                  ? 'Deine Keycloak-Sitzung ist auf diesem Gerät aktiv.'
                  : device
                    ? 'Nutze die gespeicherte Gerätebindung, um dich mit Android-Sicherheit erneut anzumelden.'
                    : 'Gib zuerst deine Identitätsdaten ein und identifiziere dich dann per Code oder SMS-TAN.'}
              </p>
            </header>

            <section className="status-card card" aria-live="polite">
              <p className="section-label">Status</p>
              <strong>{status}</strong>
              <div className="status-strip" aria-label="Android security status">
                <span className="status-pill">Keystore bereit</span>
                <span className="status-pill">Gerät gebunden</span>
              </div>
              <p className="muted-copy">
                {tokens
                  ? `Sitzung aktiv für ${tokenLifetimeLabel ?? 'begrenzte Zeit'}.`
                  : challengeExpiresAt
                     ? `Sichere Anmeldeanfrage bereit bis ${challengeExpiresAt}.`
                     : device
                       ? 'Die Gerätebindung ist auf diesem Telefon gespeichert.'
                       : 'Noch keine Gerätebindung gespeichert.'}
              </p>
            </section>

            <section className="card flow-card">
              {step === 'register' && (
                <>
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Registrierung</p>
                      <h2>Geräteanmeldung einrichten</h2>
                    </div>
                  </div>
                  <div className="android-intro">
                    <strong>Prüfe zuerst deine Personendaten und wähle dann Code oder SMS-TAN.</strong>
                    <p className="muted-copy">Die hinterlegte Methode wird gegen die beim Admin vorbereiteten Personendaten geprüft und bleibt als Flow später für Browser-Step-up wiederverwendbar.</p>
                  </div>
                  <form className="grid form-stack" onSubmit={handleRegister}>
                    <label>
                      <span className="field-label">Benutzer-ID</span>
                      <input name="userId" value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} disabled={busy} />
                    </label>
                    <label>
                      <span className="field-label">Vorname</span>
                      <input name="firstName" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} disabled={busy} />
                    </label>
                    <label>
                      <span className="field-label">Nachname</span>
                      <input name="lastName" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} disabled={busy} />
                    </label>
                    <label>
                      <span className="field-label">Geburtsdatum</span>
                      <input name="birthDate" type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} disabled={busy} />
                    </label>
                    <label>
                      <span className="field-label">Telefonnummer</span>
                      <input name="phoneNumber" value={form.phoneNumber} onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })} disabled={busy} />
                    </label>
                    <label>
                      <span className="field-label">Gerätename</span>
                      <input name="deviceName" value={form.deviceName} onChange={(event) => setForm({ ...form, deviceName: event.target.value })} disabled={busy} />
                    </label>
                    <label>
                      <span className="field-label">Bevorzugter Service</span>
                      <select name="preferredService" value={form.selectedService} onChange={(event) => setForm({ ...form, selectedService: event.target.value as AssuranceFlowService })} disabled={busy}>
                        <option value="person_code">Code</option>
                        <option value="sms_tan">SMS-TAN</option>
                      </select>
                    </label>
                    <button type="submit" disabled={busy}>Weiter</button>
                  </form>
                </>
              )}

              {step === 'register_verify' && pendingRegistration && (
                <>
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Identifikation</p>
                      <h2>Verfügbaren Service ausführen</h2>
                    </div>
                  </div>
                  <div className="android-intro">
                    <strong>Es werden nur die für diese Person vorbereiteten Services angeboten.</strong>
                    <p className="muted-copy">SMS-TAN erscheint nur mit hinterlegter Telefonnummer. Weitere Services können später über dieselbe Flow-Auswahl ergänzt werden.</p>
                  </div>
                  <label>
                    <span className="field-label">Verfügbarer Service</span>
                    <select
                      name="availableService"
                      value={form.selectedService}
                      onChange={(event) => setForm({ ...form, selectedService: event.target.value as AssuranceFlowService, code: '', tan: '' })}
                      disabled={busy}
                    >
                      {pendingRegistration.availableServices.map((service) => (
                        <option key={service.id} value={service.id}>{service.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="challenge-card">
                    <p className="section-label">Service starten</p>
                    <strong>{form.selectedService === 'sms_tan' ? 'SMS-TAN senden' : 'Code prüfen'}</strong>
                    <p className="muted-copy">
                      {form.selectedService === 'sms_tan'
                        ? `Die SMS-TAN wird an ${pendingRegistration.maskedTarget ?? 'die hinterlegte Nummer'} gesendet. Gib sie hier ein und bestätige den Schritt anschließend.`
                        : 'Der Nutzer gibt den vorbereiteten Code selbst ein.'}
                     </p>
                     <button type="button" onClick={() => void runAction(handleStartSelectedService)} disabled={busy}>
                       {form.selectedService === 'sms_tan' ? 'SMS-TAN senden' : 'Code-Eingabe starten'}
                     </button>
                   </div>
                   <form className="grid form-stack" onSubmit={handleCompleteSelectedService}>
                    {form.selectedService === 'person_code' ? (
                      <label>
                        <span className="field-label">Code</span>
                        <input name="code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} disabled={busy} />
                      </label>
                    ) : (
                      <>
                        <label>
                          <span className="field-label">SMS-TAN</span>
                          <input name="tan" value={form.tan} onChange={(event) => setForm({ ...form, tan: event.target.value })} disabled={busy} />
                        </label>
                         <button type="button" onClick={() => void handleResendTan()} disabled={busy}>Neue SMS-TAN senden</button>
                       </>
                     )}
                     <button type="submit" disabled={busy}>{form.selectedService === 'sms_tan' ? 'SMS-TAN bestätigen' : 'Identifikation abschließen'}</button>
                   </form>
                 </>
               )}

              {step === 'password' && (
                <>
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Passwort</p>
                      <h2>Neues Passwort erstellen</h2>
                    </div>
                  </div>
                  <p className="muted-copy">Dieses Konto braucht ein neues Keycloak-Passwort, bevor Android die Anmeldung abschließen kann.</p>
                  <form className="grid form-stack" onSubmit={handlePassword}>
                    <label>
                      <span className="field-label">Neues Passwort</span>
                      <input name="password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} disabled={busy} />
                    </label>
                    <button type="submit" disabled={busy}>Passwort speichern</button>
                  </form>
                </>
              )}

              {step === 'login' && device && (
                <>
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Anmeldung</p>
                      <h2>Mit gespeichertem Gerät anmelden</h2>
                    </div>
                  </div>
                  <div className="challenge-card">
                    <p className="section-label">Android-Sicherheit</p>
                    <strong>{challenge ? 'Bereit zur Bestätigung' : 'Gespeicherte Geräteanmeldung ist bereit'}</strong>
                    <p className="muted-copy">
                      {challenge
                         ? 'Bestätige dich mit der Displaysperre, um die Anmeldung abzuschließen.'
                         : 'Die App fordert eine Challenge an und öffnet danach genau einen Android-Bestätigungsdialog.'}
                    </p>
                  </div>
                  <div className="binding-stack">
                    <div className="device-summary" aria-label="Saved device summary">
                      <div>
                        <span className="field-label">Konto</span>
                        <strong>{device.userId}</strong>
                      </div>
                      <div>
                        <span className="field-label">Gerät</span>
                        <strong>{device.deviceName}</strong>
                      </div>
                    </div>
                    <div className="binding-notice" role="note" aria-label="Local device binding notice">
                      <strong>Auf diesem Telefon gespeichert</strong>
                      <p className="binding-note">Der private Schlüssel bleibt auf diesem Gerät, damit die Anmeldung auch nach Abmeldung oder Neuladen weiter funktioniert.</p>
                    </div>
                    <details className="device-details">
                      <summary>Gerätedetails</summary>
                      <p>{device.publicKeyHash}</p>
                    </details>
                    <div className="actions stacked-actions">
                      <button type="button" onClick={handleStartLogin} disabled={busy}>Mit Gerät fortfahren</button>
                      <button type="button" className="button-secondary" onClick={handleRemoveBinding} disabled={busy}>Gerätebindung entfernen</button>
                    </div>
                  </div>
                </>
              )}

              {step === 'authenticated' && tokens && device && (
                <>
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Angemeldet</p>
                      <h2>{device.deviceName}</h2>
                    </div>
                  </div>
                  <section className="token-overview" aria-label="Token overview cards">
                    <article>
                        <span>Zugriff</span>
                        <strong>Erteilt</strong>
                        <p>API-Zugriff für diese Gerätesitzung.</p>
                    </article>
                    <article>
                        <span>ID</span>
                        <strong>Bereit</strong>
                        <p>Identitätsdaten für die aktive Sitzung.</p>
                    </article>
                    <article>
                        <span>Refresh</span>
                        <strong>Gespeichert</strong>
                        <p>Hole bei Bedarf ein frisches Token-Set.</p>
                    </article>
                  </section>
                  <div className="challenge-card authenticated-card">
                    <p className="section-label">Android-Gerät</p>
                    <strong>Angemeldet und bereit</strong>
                    <p className="muted-copy">Aktualisieren holt ein neues Token-Bündel. Abmelden behält die Gerätebindung, damit Device Login weiter schnell verfügbar bleibt.</p>
                  </div>
                  <div className="actions stacked-actions">
                    <button type="button" onClick={handleRefresh} disabled={busy}>Tokens aktualisieren</button>
                    <button type="button" className="button-secondary" onClick={handleLogout} disabled={busy}>Abmelden</button>
                  </div>
                </>
              )}
            </section>

            <section className="session-stack">
              {!tokens && (
                <section className="card token-card">
                  <div className="section-heading simple-heading">
                    <div>
                      <p className="section-label">Sitzungsdetails</p>
                      <h2>Sitzungstokens</h2>
                    </div>
                  </div>
                  <TokenEmptyState hasDevice={Boolean(device)} hasChallenge={Boolean(challenge)} />
                </section>
              )}

              {tokens && (
                <>
                  <AuthenticatedTabs activeTab={activeAuthenticatedTab} onChange={setActiveAuthenticatedTab} />

                  {activeAuthenticatedTab === 'tokens' ? (
                    <section className="card token-card" id="authenticated-panel-tokens">
                      <div className="section-heading simple-heading">
                        <div>
                          <p className="section-label">Sitzungsdetails</p>
                          <h2>Sitzungstokens</h2>
                        </div>
                      </div>
                      <div className="token-section-stack">
                        <SessionTokensSection tokens={tokens} tokenLifetimeLabel={tokenLifetimeLabel} />
                        <TokenInspectionSection
                          accessClaims={accessClaims}
                          idClaims={idClaims}
                          claimKeys={sharedTokenClaimKeys}
                          userInfo={userInfo}
                          tokenIntrospection={tokenIntrospection}
                        />
                      </div>
                    </section>
                  ) : (
                    <ServiceMockApiPanel
                      serviceMockApi={serviceMockApi}
                      busy={busy}
                      onReload={() => void runAction(async () => { await syncServiceMockApi('Geschützte Mock-API synchronisiert') })}
                      onSubmit={handleCreateMockMessage}
                      onDraftChange={(draft) => setServiceMockApi((current) => ({ ...current, draft }))}
                    />
                  )}
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
        <p className="section-label">Gesperrt</p>
        <h3>Tokens erscheinen hier nach der Geräteanmeldung.</h3>
      </div>
      <p className="muted-copy">
        {hasChallenge
          ? 'Bestätige den sicheren Anmeldedialog, um den Token-Bereich zu entsperren.'
          : hasDevice
            ? 'Dieses Telefon hat bereits eine gespeicherte Gerätebindung.'
            : 'Richte dieses Telefon zuerst ein und bestätige die Registrierung per Code oder SMS-TAN.'}
      </p>
      <p>Noch keine Keycloak-Tokens.</p>
    </section>
  )
}

function AuthenticatedTabs(props: {
  activeTab: AuthenticatedTab
  onChange: (tab: AuthenticatedTab) => void
}) {
  return (
    <section className="card android-tabs-shell">
      <div className="android-tabs-header">
        <p className="section-label">Android Ansicht</p>
        <strong>Zwischen Sitzung und API wechseln</strong>
      </div>
      <div className="android-tabs" role="tablist" aria-label="Authentifizierte Bereiche">
        <button
          type="button"
          role="tab"
          id="authenticated-tab-tokens"
          className={props.activeTab === 'tokens' ? 'android-tab android-tab-active' : 'android-tab'}
          aria-selected={props.activeTab === 'tokens'}
          aria-controls="authenticated-panel-tokens"
          onClick={() => props.onChange('tokens')}
        >
          <span className="android-tab-track" aria-hidden="true">
            <span className="android-tab-indicator" />
          </span>
          <span className="android-tab-icon" aria-hidden="true">◒</span>
          <span className="android-tab-label">Token</span>
          <strong>Sitzung</strong>
        </button>
        <button
          type="button"
          role="tab"
          id="authenticated-tab-servicemock-api"
          className={props.activeTab === 'servicemock-api' ? 'android-tab android-tab-active' : 'android-tab'}
          aria-selected={props.activeTab === 'servicemock-api'}
          aria-controls="authenticated-panel-servicemock-api"
          onClick={() => props.onChange('servicemock-api')}
        >
          <span className="android-tab-track" aria-hidden="true">
            <span className="android-tab-indicator" />
          </span>
          <span className="android-tab-icon" aria-hidden="true">◎</span>
          <span className="android-tab-label">ServiceMock API</span>
          <strong>Demo API</strong>
        </button>
      </div>
    </section>
  )
}

function ServiceMockApiPanel(props: {
  serviceMockApi: ServiceMockApiState
  busy: boolean
  onReload: () => void
  onSubmit: (event: FormEvent) => void
  onDraftChange: (draft: string) => void
}) {
  return (
    <section className="card servicemock-api-shell" aria-label="Protected mock API panel" id="authenticated-panel-servicemock-api">
      <div className="section-heading simple-heading">
        <div>
          <p className="section-label">ServiceMock API</p>
          <h2>Geschützte Daten</h2>
        </div>
      </div>
      <div className="servicemock-api-console-chrome" aria-hidden="true">
        <span className="servicemock-api-console-dot" />
        <span className="servicemock-api-console-dot" />
        <span className="servicemock-api-console-dot" />
        <span className="servicemock-api-console-url">POST /api/mock/messages</span>
      </div>
      <section className="challenge-card servicemock-api-card">
        <div className="servicemock-api-hero">
          <div>
            <strong>OIDC-geschützte Demo-Endpunkte</strong>
            <p className="muted-copy">Die App ruft `servicemock-api` mit dem aktuellen Access-Token auf. Das Backend prüft JWKS-Signaturen und die Audience `servicemock-api`, bevor Daten ausgeliefert werden.</p>
          </div>
          <div className="servicemock-api-badge-stack" aria-hidden="true">
            <span>Bearer-Token</span>
            <span>JWKS geprüft</span>
          </div>
        </div>
        <div className="device-summary servicemock-api-summary">
          <div>
            <span className="field-label">Audience</span>
            <strong>{props.serviceMockApi.profile?.audience.join(', ') ?? 'Noch nicht geladen'}</strong>
          </div>
          <div>
            <span className="field-label">Benutzername</span>
            <strong>{props.serviceMockApi.profile?.username ?? 'Noch nicht geladen'}</strong>
          </div>
          <div>
            <span className="field-label">Client</span>
            <strong>{props.serviceMockApi.profile?.clientId ?? 'Noch nicht geladen'}</strong>
          </div>
          <div>
            <span className="field-label">Berechtigungen</span>
            <strong>{props.serviceMockApi.profile?.scope.join(', ') ?? 'Noch nicht geladen'}</strong>
          </div>
        </div>
        <p className="servicemock-api-status">{props.serviceMockApi.status}</p>
        <div className="actions servicemock-api-actions">
          <button type="button" onClick={props.onReload} disabled={props.busy}>ServiceMock API neu laden</button>
        </div>
        <form className="grid form-stack servicemock-api-composer" onSubmit={props.onSubmit}>
          <label>
            <span className="field-label">Neue geschützte Notiz</span>
            <textarea name="serviceMockApiDraft" value={props.serviceMockApi.draft} onChange={(event) => props.onDraftChange(event.target.value)} disabled={props.busy} rows={4} />
          </label>
          <button type="submit" disabled={props.busy}>Notiz an ServiceMock API senden</button>
        </form>
        <div className="message-list" aria-label="Protected mock API messages">
          {props.serviceMockApi.messages.map((message) => (
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
        <p className="section-label">Android-Sicherheit</p>
        <h3>{props.prompt.title}</h3>
        <p className="muted-copy">{props.prompt.body}</p>
        <p className="prompt-caption">{props.prompt.caption}</p>
        <div className="prompt-helper">
          <span className="prompt-helper-dot" aria-hidden="true" />
          <p>Nutze Fingerabdruck, Face Unlock oder die Geräte-PIN aus der Android-Systemsicherheit.</p>
        </div>

        <div className="actions stacked-actions">
          <button type="button" onClick={props.onConfirm} disabled={props.busy}>{props.prompt.confirmLabel}</button>
          <button type="button" className="button-secondary" onClick={props.onCancel} disabled={props.busy}>Abbrechen</button>
        </div>
      </section>
    </div>
  )
}

function TokenHero({ tokens, tokenLifetimeLabel }: { tokens: SessionTokenBundle; tokenLifetimeLabel: string | null }) {
  return (
    <section className="token-hero" aria-label="Authenticated token summary">
      <article>
        <span>Token-Typ</span>
        <strong>{tokens.tokenType}</strong>
      </article>
      <article>
        <span>Scope</span>
        <strong>{tokens.scope || 'Nicht verfügbar'}</strong>
      </article>
      <article>
        <span>Läuft ab in</span>
        <strong>{tokenLifetimeLabel ?? `${tokens.expiresIn} Sekunden`}</strong>
      </article>
    </section>
  )
}

function SessionTokensSection(props: {
  tokens: SessionTokenBundle
  tokenLifetimeLabel: string | null
}) {
  return (
    <section className="token-section" aria-label="Session token section">
      <div className="section-heading simple-heading">
        <div>
          <p className="section-label">Session</p>
          <h3>Sitzung und Weiterverwendung</h3>
        </div>
      </div>
      <p className="muted-copy">Diese Felder halten die aktive Gerätesitzung am Leben und werden für Refresh, Logout und geschützte API-Aufrufe verwendet.</p>
      <TokenHero tokens={props.tokens} tokenLifetimeLabel={props.tokenLifetimeLabel} />
      <div className="token-grid token-grid-session">
        <SessionRawTokensPanel accessToken={props.tokens.accessToken} idToken={props.tokens.idToken} />
        <RefreshTokenPanel refreshToken={props.tokens.refreshToken} />
      </div>
    </section>
  )
}

function SessionRawTokensPanel(props: { accessToken: string; idToken: string }) {
  return (
    <article className="token-panel token-panel-comparison">
      <h3>Access- und ID-Token</h3>
      <p className="muted-copy">Die rohen JWTs der aktiven Gerätesitzung. Diese beiden Werte werden für authentifizierte Requests und Session-Fortsetzung verwendet.</p>
      <div className="raw-token-grid">
        <details className="token-raw" open>
          <summary>Access-Token JWT</summary>
          <textarea name="accessToken" value={props.accessToken} readOnly rows={8} />
        </details>
        <details className="token-raw" open>
          <summary>ID-Token JWT</summary>
          <textarea name="idToken" value={props.idToken} readOnly rows={8} />
        </details>
      </div>
    </article>
  )
}

function RefreshTokenPanel(props: { refreshToken: string }) {
  return (
    <article className="token-panel">
      <h3>Refresh-Token</h3>
      <p className="muted-copy">Der Refresh-Token verlängert die bestehende Gerätesitzung, ohne die Registrierung oder Gerätebindung erneut auszuführen.</p>
      <details className="token-raw">
        <summary>Refresh-Token JWT</summary>
        <textarea name="Refresh-Token JWT" value={props.refreshToken} readOnly rows={8} />
      </details>
    </article>
  )
}

function ClaimHighlights({ accessClaims, idClaims }: { accessClaims: ClaimRecord | null; idClaims: ClaimRecord | null }) {
  const username = readString(accessClaims, 'preferred_username') ?? readString(idClaims, 'preferred_username') ?? 'Nicht verfügbar'
  const userId = readString(accessClaims, 'userId') ?? readString(idClaims, 'userId') ?? username
  const subject = readString(accessClaims, 'sub') ?? readString(idClaims, 'sub') ?? 'Nicht verfügbar'
  const expiresAt = formatExpiry(readNumber(accessClaims, 'exp') ?? readNumber(idClaims, 'exp'))
  const roles = extractRoles(accessClaims)
  const assuranceLevel = readString(accessClaims, 'acr') ?? readString(idClaims, 'acr') ?? 'Nicht verfügbar'

  return (
    <section className="claim-summary" aria-label="Token claim summary">
      <article>
        <span>Benutzer-ID</span>
        <strong>{userId}</strong>
      </article>
      <article>
        <span>Benutzername</span>
        <strong>{username}</strong>
      </article>
      <article>
        <span>Sitzungs-ID</span>
        <strong>{subject}</strong>
      </article>
      <article>
        <span>Rollen</span>
        <strong>{roles.length ? roles.join(', ') : 'Keine Rollen'}</strong>
      </article>
      <article>
        <span>Assurance Level</span>
        <strong>{assuranceLevel}</strong>
      </article>
      <article>
        <span>Endet</span>
        <strong>{expiresAt}</strong>
      </article>
    </section>
  )
}

function TokenInspectionSection(props: {
  accessClaims: ClaimRecord | null
  idClaims: ClaimRecord | null
  claimKeys: string[]
  userInfo: ClaimRecord | null
  tokenIntrospection: ClaimRecord | null
}) {
  return (
    <section className="token-section" aria-label="Token inspection section">
      <div className="section-heading simple-heading">
        <div>
          <p className="section-label">Anzeige</p>
          <h3>Token-Inspektion und Hilfsansichten</h3>
        </div>
      </div>
      <p className="muted-copy">Diese Daten dienen der Anzeige im Demo-Frontend. Sie helfen beim Verstehen der Tokens, werden aber nicht zum Abschluss von Registrierung oder Login benötigt.</p>
      <ClaimHighlights accessClaims={props.accessClaims} idClaims={props.idClaims} />
      <div className="token-grid">
        <TokenComparisonPanel
          accessClaims={props.accessClaims}
          idClaims={props.idClaims}
          claimKeys={props.claimKeys}
        />
        <JsonPanel title="Userinfo-Endpunkt" payload={props.userInfo} rawLabel="Userinfo Antwort JSON" />
        <JsonPanel title="Introspection-Endpunkt" payload={props.tokenIntrospection} rawLabel="Introspection Antwort JSON" />
      </div>
    </section>
  )
}

function TokenComparisonPanel(props: {
  accessClaims: ClaimRecord | null
  idClaims: ClaimRecord | null
  claimKeys: string[]
}) {
  return (
    <article className="token-panel token-panel-comparison">
      <h3>Access- und ID-Token</h3>
      <p className="muted-copy">Dekodierte Claims der aktiven Android-Sitzung.</p>
      <details className="token-details">
        <summary>Dekodierte Token-Details</summary>
        {props.accessClaims && props.idClaims ? (
          <TokenComparisonTable accessClaims={props.accessClaims} idClaims={props.idClaims} claimKeys={props.claimKeys} />
        ) : (
          <p className="muted-copy">Dekodierte Claims sind nicht verfügbar.</p>
        )}
      </details>
    </article>
  )
}

function JsonPanel({ title, payload, rawLabel }: { title: string; payload: ClaimRecord | null; rawLabel: string }) {
  const summaryItems = title === 'Userinfo-Endpunkt'
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
      ) : <p className="muted-copy">Keine Endpunkt-Antwort verfügbar.</p>}
      <details className="token-raw">
        <summary>{rawLabel}</summary>
        <textarea name={rawLabel} value={payload ? JSON.stringify(payload, null, 2) : ''} readOnly rows={8} />
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
      <table className="claims-table claims-table-comparison" aria-label="Access- und ID-Token Claims">
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Access-Token</th>
            <th scope="col">ID-Token</th>
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

  return 'Im Geräte-Flow ist ein unerwarteter Fehler aufgetreten'
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
    return 'Nicht verfügbar'
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
  const username = readString(payload, 'preferred_username') ?? 'Nicht verfügbar'
  const subject = readString(payload, 'sub') ?? 'Nicht verfügbar'
  const fallbackName = [readString(payload, 'given_name'), readString(payload, 'family_name')].filter(Boolean).join(' ')
  const fullName = readString(payload, 'name') ?? (fallbackName || 'Nicht verfügbar')
  const emailVerified = readBoolean(payload, 'email_verified')

  return [
    { label: 'Benutzername', value: username },
    { label: 'Subjekt', value: subject },
    { label: 'Name', value: fullName },
    { label: 'E-Mail bestätigt', value: emailVerified === null ? 'Nicht verfügbar' : emailVerified ? 'Ja' : 'Nein' }
  ]
}

function buildIntrospectionSummary(payload: ClaimRecord | null) {
  const active = readBoolean(payload, 'active')
  const username = readString(payload, 'username') ?? readString(payload, 'preferred_username') ?? 'Nicht verfügbar'
  const subject = readString(payload, 'sub') ?? 'Nicht verfügbar'
  const scope = readString(payload, 'scope') ?? 'Nicht verfügbar'
  const expiresAt = formatExpiry(readNumber(payload, 'exp'))

  return [
    { label: 'Aktiv', value: active === null ? 'Nicht verfügbar' : active ? 'Ja' : 'Nein' },
    { label: 'Benutzername', value: username },
    { label: 'Subjekt', value: subject },
    { label: 'Läuft ab', value: expiresAt },
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

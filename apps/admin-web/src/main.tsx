import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'

import type {
  ArtifactDetailResponse,
  DeviceRecord,
  RegistrationCodeRecord,
  SpanDetailResponse,
  TraceDetailResponse,
  TraceListItem,
  TraceListResponse
} from '@auth-sandbox-2/shared-types'

import './styles.css'

const API_BASE = import.meta.env.VITE_AUTH_API_URL ?? 'https://auth.localhost:8443'
const ADMIN_OVERVIEW_HASH = '#admin'
const TRACE_BROWSER_HASH = '#trace-browser'
const LEGACY_TRACE_EXPLORER_HASH = '#trace-explorer'
const TRACE_DETAIL_PREFIX = '#trace/'

type ProxyLogRecord = {
  ts?: string
  request?: {
    method?: string
    uri?: string
  }
  status?: number
  host?: string
  correlation_id?: string
  trace_id?: string
  client_name?: string
  upstream_host?: string
  upstream_duration_ms?: string | number
  upstream_latency_ms?: string | number
}

type Route =
  | { name: 'overview' }
  | { name: 'trace-browser' }
  | { name: 'trace-detail'; traceId: string }

function createTraceHeaders() {
  const traceId = crypto.randomUUID()
  return {
    'x-trace-id': traceId,
    'x-correlation-id': traceId,
    'x-client-name': 'admin-web'
  }
}

async function request<T>(path: string, init?: RequestInit) {
  const traceHeaders = createTraceHeaders()
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...traceHeaders,
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

function parseRoute(hash: string): Route {
  if (hash.startsWith(TRACE_DETAIL_PREFIX)) {
    const traceId = decodeURIComponent(hash.slice(TRACE_DETAIL_PREFIX.length))
    if (traceId) {
      return { name: 'trace-detail', traceId }
    }
  }

  if (hash === TRACE_BROWSER_HASH || hash === LEGACY_TRACE_EXPLORER_HASH) {
    return { name: 'trace-browser' }
  }

  return { name: 'overview' }
}

function navigateToRoute(route: Route) {
  if (route.name === 'trace-detail') {
    window.location.hash = `${TRACE_DETAIL_PREFIX}${encodeURIComponent(route.traceId)}`
    return
  }

  if (route.name === 'trace-browser') {
    window.location.hash = TRACE_BROWSER_HASH
    return
  }

  window.location.hash = ADMIN_OVERVIEW_HASH
}

function formatTimestamp(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return 'unbekannte Zeit'
  }

  const normalizedValue = typeof value === 'number'
    ? new Date(value < 1_000_000_000_000 ? value * 1000 : value).toISOString()
    : value

  const date = new Date(normalizedValue)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  const formatted = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date)

  return `${formatted} UTC`
}

function formatTraceInspectorHeading(trace: TraceDetailResponse['trace'] | null | undefined) {
  return trace ? 'Detailinspektion' : 'Trace-Detailinspektion'
}

function formatTraceStatus(status: TraceListItem['status']) {
  switch (status) {
    case 'running':
      return 'läuft'
    case 'success':
      return 'erfolgreich'
    case 'error':
      return 'fehlerhaft'
    default:
      return status
  }
}

function formatArtifactView(value: unknown, emptyLabel: string) {
  if (value === undefined) {
    return emptyLabel
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

function isChallengeEnvelope(value: unknown) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'encryptedData' in value &&
    'encryptedKey' in value &&
    'iv' in value
  )
}

function isEncryptedChallengeArtifact(artifact: ArtifactDetailResponse) {
  return artifact.artifact.name === 'encrypted_challenge' || isChallengeEnvelope(artifact.views.decoded)
}

function withEpochComments(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withEpochComments)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const nextValue = withEpochComments(entry)
        if (isEpochField(key, entry)) {
          return [key, `${entry} /* ${formatEpochTimestamp(entry)} */`]
        }

        return [key, nextValue]
      })
    )
  }

  return value
}

function isEpochField(key: string, value: unknown) {
  return (key === 'exp' || key === 'iat') && typeof value === 'number'
}

function formatEpochTimestamp(value: number) {
  return formatTimestamp(new Date(value * 1000).toISOString())
}

function summarizeSpan(span: TraceDetailResponse['spans'][number]) {
  return [span.actorName, span.kind, span.status].join(' - ')
}

function formatDuration(value: number | null) {
  if (value === null) {
    return 'läuft noch'
  }

  if (value < 1000) {
    return `${value} ms`
  }

  return `${(value / 1000).toFixed(1)} s`
}

function describeTraceActors(trace: TraceListItem) {
  return trace.actors.length ? trace.actors.join(' -> ') : 'Keine Akteure erfasst'
}

function describeSpanTarget(span: TraceDetailResponse['spans'][number] | SpanDetailResponse['span']) {
  return span.route ?? span.method ?? span.url ?? span.targetName ?? null
}

function compactMetaItems(items: Array<[string, string | null | undefined]>) {
  return items.reduce<Array<[string, string]>>((result, [label, value]) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      result.push([label, value])
    }

    return result
  }, [])
}

async function loadProxyLogs(correlationId: string) {
  try {
    const response = await fetch('/caddy-logs/access.json')
    if (!response.ok) {
      return []
    }

    const raw = await response.text()
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ProxyLogRecord)
      .filter((entry) => entry.correlation_id === correlationId)
      .slice(-30)
      .reverse()
  } catch {
    return []
  }
}

function AdminApp() {
  const [codes, setCodes] = useState<RegistrationCodeRecord[]>([])
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [traces, setTraces] = useState<TraceListItem[]>([])
  const [selectedTrace, setSelectedTrace] = useState<TraceDetailResponse | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceQuery, setTraceQuery] = useState('')
  const [codeQuery, setCodeQuery] = useState('')
  const [deviceQuery, setDeviceQuery] = useState('')
  const [form, setForm] = useState({ userId: 'demo-user', displayName: 'Demo User', validForDays: 30 })
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const traceBrowserDetailRef = useRef<HTMLElement | null>(null)

  async function refresh() {
    const [codesResult, devicesResult, tracesResult] = await Promise.all([
      request<RegistrationCodeRecord[]>('/api/admin/registration-codes'),
      request<DeviceRecord[]>('/api/admin/devices'),
      request<TraceListResponse>('/api/observability/traces?page=1&pageSize=30')
    ])

    setCodes(codesResult)
    setDevices(devicesResult)
    setTraces(tracesResult.items)
  }

  useEffect(() => {
    function handleHashChange() {
      setRoute(parseRoute(window.location.hash))
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

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

  async function handlePreviewTrace(traceId: string) {
    setTraceLoading(true)
    try {
      const detail = await request<TraceDetailResponse>(`/api/observability/traces/${traceId}`)
      setSelectedTrace(detail)

      if (window.matchMedia('(max-width: 980px)').matches) {
        requestAnimationFrame(() => {
          traceBrowserDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      }
    } finally {
      setTraceLoading(false)
    }
  }

  const filteredTraces = useMemo(() => {
    const query = traceQuery.trim().toLowerCase()
    if (!query) {
      return traces
    }

    return traces.filter((trace) => {
      const haystack = [trace.title, trace.traceType, trace.status, formatTraceStatus(trace.status), trace.actors.join(' ')].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [traceQuery, traces])

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

  useEffect(() => {
    if (route.name !== 'trace-browser') {
      return
    }

    if (traceLoading || filteredTraces.length === 0) {
      return
    }

    const selectedTraceId = selectedTrace?.trace.traceId
    if (selectedTraceId && filteredTraces.some((trace) => trace.traceId === selectedTraceId)) {
      return
    }

    void handlePreviewTrace(filteredTraces[0].traceId)
  }, [filteredTraces, route, selectedTrace, traceLoading])

  if (route.name === 'trace-detail') {
    return <TraceInspectorPage traceId={route.traceId} onBack={() => navigateToRoute({ name: 'trace-browser' })} />
  }

  if (route.name === 'trace-browser') {
    return (
      <TraceBrowserPage
        detailRef={traceBrowserDetailRef}
        filteredTraces={filteredTraces}
        selectedTrace={selectedTrace}
        traceLoading={traceLoading}
        traceQuery={traceQuery}
        onBack={() => navigateToRoute({ name: 'overview' })}
        onChangeQuery={setTraceQuery}
        onOpenDetail={(traceId) => navigateToRoute({ name: 'trace-detail', traceId })}
        onRefresh={() => void refresh()}
        onSelectTrace={(traceId) => void handlePreviewTrace(traceId)}
      />
    )
  }

  return (
    <AdminOverviewPage
      codes={filteredCodes}
      devices={filteredDevices}
      codeCount={codes.length}
      deviceCount={devices.length}
      codeQuery={codeQuery}
      deviceQuery={deviceQuery}
      form={form}
      onCreate={handleCreate}
      onOpenTraceBrowser={() => navigateToRoute({ name: 'trace-browser' })}
      setCodeQuery={setCodeQuery}
      setDeviceQuery={setDeviceQuery}
      setForm={setForm}
    />
  )
}

function AdminOverviewPage(props: {
  codes: RegistrationCodeRecord[]
  devices: DeviceRecord[]
  codeCount: number
  deviceCount: number
  codeQuery: string
  deviceQuery: string
  form: { userId: string; displayName: string; validForDays: number }
  onCreate: (event: FormEvent) => Promise<void>
  onOpenTraceBrowser: () => void
  setCodeQuery: (value: string) => void
  setDeviceQuery: (value: string) => void
  setForm: (next: { userId: string; displayName: string; validForDays: number }) => void
}) {
  return (
    <main className="shell admin-overview-shell">
      <section className="admin-overview-grid">
        <section className="card hero admin-hero">
          <p className="eyebrow">Admin-Oberfläche</p>
          <h1>Verwalte Registrierungscodes, behalte Geräte im Blick und springe bei Bedarf direkt in den Trace-Browser.</h1>
          <p className="section-copy">Die Übersicht bündelt die häufigsten Admin-Aufgaben an einem Ort, während der Trace-Browser bewusst separat für die tiefe Analyse bleibt.</p>
          <div className="admin-summary-row" aria-label="Admin Überblickszahlen">
            <article className="admin-summary-chip">
              <span>Registrierungscodes</span>
              <strong>{props.codeCount}</strong>
            </article>
            <article className="admin-summary-chip">
              <span>Geräte</span>
              <strong>{props.deviceCount}</strong>
            </article>
          </div>
        </section>

        <aside className="card trace-entry-card admin-trace-card">
          <p className="eyebrow">Trace-Browser</p>
          <h2>Öffne die Diagnoseansicht für lange Listen, ausgewählte Details und Deep Inspection.</h2>
          <p className="section-copy">Dort kannst du Flows filtern, Spans lesen und Payloads prüfen, ohne die Verwaltungsansicht zu überladen.</p>
          <div className="button-row">
            <button type="button" onClick={props.onOpenTraceBrowser}>Trace-Browser öffnen</button>
          </div>
        </aside>

        <section className="card admin-form-card">
          <div className="list-card-header">
            <div>
              <h2>Registrierungscode erstellen</h2>
              <p className="section-copy">Lege neue Aktivierungscodes an, damit Geräte schnell für den Demo-Flow registriert werden können.</p>
            </div>
          </div>
          <form className="grid" onSubmit={props.onCreate}>
          <label>
            User ID
            <input value={props.form.userId} onChange={(event) => props.setForm({ ...props.form, userId: event.target.value })} />
          </label>
          <label>
            Anzeigename
            <input value={props.form.displayName} onChange={(event) => props.setForm({ ...props.form, displayName: event.target.value })} />
          </label>
          <label>
            Gültig für Tage
            <input type="number" value={props.form.validForDays} onChange={(event) => props.setForm({ ...props.form, validForDays: Number(event.target.value) })} />
          </label>
          <button type="submit">Code erstellen</button>
        </form>
        </section>

        <section className="admin-list-grid">
          <section className="card list-card admin-list-card">
            <div className="list-card-header">
              <div>
                <h2>Registrierungscodes</h2>
                <p className="section-copy">Aktive Codes für neue Geräte-Registrierungen.</p>
              </div>
              <strong>{props.codeCount}</strong>
            </div>
            <label className="admin-list-search">
              Registrierungscodes durchsuchen
              <input
                aria-label="Registrierungscodes durchsuchen"
                placeholder="User ID, Code oder Nutzung suchen"
                value={props.codeQuery}
                onChange={(event) => props.setCodeQuery(event.target.value)}
              />
            </label>
            <div className="list admin-list-scroll">
              {props.codes.map((code) => (
                <article key={code.id}>
                  <strong>{code.userId}</strong>
                  <span>{code.code}</span>
                  <span>Nutzungen: {code.useCount}</span>
                </article>
              ))}
              {!props.codes.length && <p>{props.codeCount ? 'Keine Registrierungscodes passen zur aktuellen Suche.' : 'Noch keine Registrierungscodes vorhanden.'}</p>}
            </div>
          </section>

          <section className="card list-card admin-list-card">
            <div className="list-card-header">
              <div>
                <h2>Geräte</h2>
                <p className="section-copy">Bereits registrierte Gerätebindungen im Demo-System.</p>
              </div>
              <strong>{props.deviceCount}</strong>
            </div>
            <label className="admin-list-search">
              Geräte durchsuchen
              <input
                aria-label="Geräte durchsuchen"
                placeholder="User ID, Gerätename oder Hash suchen"
                value={props.deviceQuery}
                onChange={(event) => props.setDeviceQuery(event.target.value)}
              />
            </label>
            <div className="list admin-list-scroll">
              {props.devices.map((device) => (
                <article key={device.id}>
                  <strong>{device.userId}</strong>
                  <span>{device.deviceName}</span>
                  <span>{device.publicKeyHash}</span>
                </article>
              ))}
              {!props.devices.length && <p>{props.deviceCount ? 'Keine Geräte passen zur aktuellen Suche.' : 'Noch keine Geräte registriert.'}</p>}
            </div>
          </section>
        </section>
      </section>
    </main>
  )
}

function TraceBrowserPage(props: {
  detailRef: React.RefObject<HTMLElement | null>
  filteredTraces: TraceListItem[]
  selectedTrace: TraceDetailResponse | null
  traceLoading: boolean
  traceQuery: string
  onBack: () => void
  onChangeQuery: (value: string) => void
  onOpenDetail: (traceId: string) => void
  onRefresh: () => void
  onSelectTrace: (traceId: string) => void
}) {
  return (
    <main className="shell trace-browser-shell">
      <section className="card trace-hero trace-page-hero">
        <div className="trace-column-header">
          <div>
            <p className="eyebrow">Trace-Browser</p>
            <h1>Behalte den ausgewählten Trace im Blick und öffne die Detailinspektion nur dann, wenn du tiefer einsteigen willst.</h1>
          </div>
          <button type="button" className="secondary-button" onClick={props.onBack}>Zurück zur Admin-Übersicht</button>
        </div>
        <p className="trace-warning">Im Demo-Modus werden alle Payloads erfasst, auch sensible Werte, verschlüsselte Blöcke und decodierte JWT-Claims.</p>
      </section>

      <section className="trace-browser-layout trace-browser-layout-wide">
        <aside className="card trace-column trace-list-card">
          <div className="trace-column-header">
            <div>
              <h2>Traces</h2>
              <p className="section-copy">Mit der Suche grenzt du lange Listen ein. Der ausgewählte Trace bleibt rechts sichtbar.</p>
            </div>
            <button type="button" onClick={props.onRefresh}>Neu laden</button>
          </div>
          <label className="trace-search">
            Traces durchsuchen
            <input
              aria-label="Traces durchsuchen"
              placeholder="Titel, Akteur oder Status suchen"
              value={props.traceQuery}
              onChange={(event) => props.onChangeQuery(event.target.value)}
            />
          </label>
          <div className="trace-list" role="list" aria-label="Trace list">
            {props.filteredTraces.map((trace) => {
              const isActive = props.selectedTrace?.trace.traceId === trace.traceId
              return (
                <button
                  key={trace.traceId}
                  type="button"
                  className={`trace-list-item trace-list-row${isActive ? ' is-active' : ''}`}
                  onClick={() => props.onSelectTrace(trace.traceId)}
                >
                  <div className="trace-list-row-header">
                    <strong>{trace.title}</strong>
                    <span className={`trace-status-chip trace-status-${trace.status}`}>{formatTraceStatus(trace.status)}</span>
                  </div>
                  <span className="trace-list-timestamp">Gestartet {formatTimestamp(trace.startedAt)}</span>
                  <span>{describeTraceActors(trace)}</span>
                  <div className="trace-chip-row">
                    <span className="trace-chip">{trace.traceType}</span>
                    <span className="trace-chip">{trace.spanCount} Spans</span>
                    <span className="trace-chip">{formatDuration(trace.durationMs)}</span>
                    {trace.errorCount > 0 && <span className="trace-chip trace-chip-alert">{trace.errorCount} Fehler</span>}
                  </div>
                </button>
              )
            })}
            {!props.filteredTraces.length && <p>Keine Traces passen zur aktuellen Suche.</p>}
          </div>
        </aside>

        <section ref={props.detailRef} className="card trace-column trace-browser-detail-card">
          <div className="trace-column-header">
            <div>
              <h2>Ausgewählter Trace</h2>
              <p className="section-copy">Hier siehst du den Ablauf auf hoher Ebene. Öffne die Inspektionsseite für Artefakte, Proxy-Hops und Span-Payloads.</p>
            </div>
            {props.selectedTrace && (
              <button type="button" onClick={() => props.onOpenDetail(props.selectedTrace!.trace.traceId)}>
                Detailinspektion öffnen
              </button>
            )}
          </div>
          {props.traceLoading && <p>Trace wird geladen...</p>}
          {!props.selectedTrace && !props.traceLoading && <p>Wähle links einen Trace aus, um Zusammenfassung und Ablauf im Blick zu behalten.</p>}
          {props.selectedTrace && (
            <div className="trace-detail trace-browser-detail">
              <section className="trace-browser-story">
                <div className="trace-spotlight">
                  <div className="trace-spotlight-header">
                    <div className="trace-chip-row">
                      <span className={`trace-status-chip trace-status-${props.selectedTrace.trace.status}`}>{formatTraceStatus(props.selectedTrace.trace.status)}</span>
                      <span className="trace-chip">{props.selectedTrace.trace.traceType}</span>
                    </div>
                    <h3>{props.selectedTrace.trace.title}</h3>
                  </div>
                  <p className="trace-summary-lead">{props.selectedTrace.trace.summary ?? 'Keine Zusammenfassung verfügbar.'}</p>
                  <div className="trace-fact-list">
                    <article><span>Gestartet</span><strong>{formatTimestamp(props.selectedTrace.trace.startedAt)}</strong></article>
                    <article><span>Dauer</span><strong>{formatDuration(props.selectedTrace.trace.durationMs)}</strong></article>
                    <article><span>Beteiligte</span><strong>{props.selectedTrace.lanes.map((lane) => lane.actorName).join(', ') || 'Keine Akteure erfasst'}</strong></article>
                  </div>
                  <div className="trace-support-meta" aria-label="Trace Zusatzmetadaten">
                    {compactMetaItems([
                      ['Trace-ID', props.selectedTrace.trace.traceId],
                      ['Correlation-ID', props.selectedTrace.trace.correlationId],
                      ['Session', props.selectedTrace.trace.sessionId],
                      ['Benutzer', props.selectedTrace.trace.userId],
                      ['Gerät', props.selectedTrace.trace.deviceId]
                    ]).map(([label, value]) => (
                      <span key={label}>{label}: {value}</span>
                    ))}
                  </div>
                </div>
              </section>
              <section className="trace-browser-story">
                <h3>Ablauf</h3>
                <div className="trace-flow-list" role="list" aria-label="Trace spans timeline">
                {props.selectedTrace.spans.map((span) => (
                  <article key={span.spanId} className="trace-flow-item">
                    <div className="trace-flow-time">
                      <span>{formatTimestamp(span.startedAt)}</span>
                    </div>
                    <div className="trace-flow-copy">
                      <div className="trace-flow-header">
                        <strong>{span.operation}</strong>
                        <div className="trace-chip-row">
                          <span className="trace-chip">{span.actorName}</span>
                          <span className="trace-chip">{span.kind}</span>
                          <span className={`trace-status-chip trace-status-${span.status}`}>{formatTraceStatus(span.status)}</span>
                        </div>
                      </div>
                      {describeSpanTarget(span) && <span>{describeSpanTarget(span)}</span>}
                      <span>{formatDuration(span.durationMs)}</span>
                    </div>
                  </article>
                ))}
                </div>
              </section>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

function TraceInspectorPage(props: { traceId: string; onBack: () => void }) {
  const [traceDetail, setTraceDetail] = useState<TraceDetailResponse | null>(null)
  const [selectedSpan, setSelectedSpan] = useState<SpanDetailResponse | null>(null)
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetailResponse | null>(null)
  const [proxyLogs, setProxyLogs] = useState<ProxyLogRecord[]>([])
  const [traceLoading, setTraceLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadTrace() {
      setTraceLoading(true)
      setLoadError(null)

      try {
        const detail = await request<TraceDetailResponse>(`/api/observability/traces/${props.traceId}`)
        const logs = await loadProxyLogs(detail.trace.correlationId)

        if (cancelled) {
          return
        }

        setTraceDetail(detail)
        setProxyLogs(logs)
        setSelectedSpan(null)
        setSelectedArtifact(null)
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Trace-Details konnten nicht geladen werden.')
          setTraceDetail(null)
          setProxyLogs([])
          setSelectedSpan(null)
          setSelectedArtifact(null)
        }
      } finally {
        if (!cancelled) {
          setTraceLoading(false)
        }
      }
    }

    void loadTrace()

    return () => {
      cancelled = true
    }
  }, [props.traceId])

  async function handleSelectSpan(spanId: string) {
    const detail = await request<SpanDetailResponse>(`/api/observability/spans/${spanId}`)
    setSelectedSpan(detail)
    setSelectedArtifact(null)
  }

  async function handleSelectArtifact(artifactId: string) {
    const detail = await request<ArtifactDetailResponse>(`/api/observability/artifacts/${artifactId}`)
    setSelectedArtifact(detail)
  }

  return (
    <main className="shell">
      <section className="card trace-hero trace-detail-hero">
        <div className="trace-column-header">
          <div>
            <p className="eyebrow">Trace-Inspektor</p>
            <h1>{formatTraceInspectorHeading(traceDetail?.trace)}</h1>
          </div>
          <button type="button" className="secondary-button" onClick={props.onBack}>Zurück zum Trace-Browser</button>
        </div>
        {traceDetail && <p className="section-copy">{traceDetail.trace.title}</p>}
        <p className="trace-warning">Diese Seite zeigt Requests und Responses je Span, decodierte Payloads, entschlüsselte Challenge-Daten und die dazugehörigen Proxy-Hops.</p>
      </section>

      <section className="trace-inspector-layout">
        <article className="card trace-column">
          <h2>Trace-Details</h2>
          {traceLoading && <p>Trace wird geladen...</p>}
          {loadError && <p>{loadError}</p>}
          {!traceDetail && !traceLoading && !loadError && <p>Wähle zuerst im Trace-Browser einen Trace aus.</p>}
          {traceDetail && (
            <div className="trace-detail">
              <div className="trace-spotlight">
                <div className="trace-spotlight-header">
                  <div className="trace-chip-row">
                    <span className={`trace-status-chip trace-status-${traceDetail.trace.status}`}>{formatTraceStatus(traceDetail.trace.status)}</span>
                    <span className="trace-chip">{traceDetail.trace.traceType}</span>
                  </div>
                  <h3>{traceDetail.trace.title}</h3>
                </div>
                <p className="trace-summary-lead">{traceDetail.trace.summary ?? 'Keine Zusammenfassung verfügbar.'}</p>
                <div className="trace-fact-list">
                  <article><span>Gestartet</span><strong>{formatTimestamp(traceDetail.trace.startedAt)}</strong></article>
                  <article><span>Dauer</span><strong>{formatDuration(traceDetail.trace.durationMs)}</strong></article>
                  <article><span>Beteiligte</span><strong>{traceDetail.lanes.map((lane) => lane.actorName).join(', ') || 'Keine Akteure erfasst'}</strong></article>
                </div>
                <div className="trace-support-meta" aria-label="Trace Zusatzmetadaten">
                  {compactMetaItems([
                      ['Trace-ID', traceDetail.trace.traceId],
                      ['Correlation-ID', traceDetail.trace.correlationId],
                      ['Session', traceDetail.trace.sessionId],
                      ['Benutzer', traceDetail.trace.userId],
                      ['Gerät', traceDetail.trace.deviceId]
                    ]).map(([label, value]) => (
                      <span key={label}>{label}: {value}</span>
                    ))}
                </div>
              </div>
              <div className="trace-timeline" role="list" aria-label="Trace spans timeline">
                {traceDetail.spans.map((span) => {
                  const isActive = selectedSpan?.span.spanId === span.spanId
                  return (
                    <button
                      key={span.spanId}
                      type="button"
                      className={`trace-span-item${isActive ? ' is-active' : ''}`}
                      onClick={() => void handleSelectSpan(span.spanId)}
                    >
                      <strong>{span.actorName}</strong>
                      <span>{span.operation}</span>
                      <span>{formatTimestamp(span.startedAt)}</span>
                      <span>{span.kind}</span>
                      <span>{formatTraceStatus(span.status)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </article>

        <article className="card trace-column">
          <h2>Span- und Artefaktdetails</h2>
          {!selectedSpan && <p>Wähle einen Span aus, um Requests, Responses, decodierte JWTs und die verschlüsselte Challenge näher zu prüfen.</p>}
          {selectedSpan && (
            <div className="trace-detail">
              <div className="trace-spotlight trace-spotlight-compact">
                <div className="trace-spotlight-header">
                  <div className="trace-chip-row">
                    <span className="trace-chip">{selectedSpan.span.actorName}</span>
                    <span className="trace-chip">{selectedSpan.span.kind}</span>
                    <span className={`trace-status-chip trace-status-${selectedSpan.span.status}`}>{formatTraceStatus(selectedSpan.span.status)}</span>
                  </div>
                  <h3>{selectedSpan.span.operation}</h3>
                </div>
                <div className="trace-fact-list trace-fact-list-compact">
                  <article><span>Gestartet</span><strong>{formatTimestamp(selectedSpan.span.startedAt)}</strong></article>
                  <article><span>Dauer</span><strong>{formatDuration(selectedSpan.span.durationMs)}</strong></article>
                  <article><span>Ziel</span><strong>{describeSpanTarget(selectedSpan.span) ?? 'Kein Ziel erfasst'}</strong></article>
                  <article><span>Artefakte</span><strong>{String(selectedSpan.artifacts.length)}</strong></article>
                </div>
                {selectedSpan.span.notes && <p className="trace-summary-lead trace-summary-lead-compact">{selectedSpan.span.notes}</p>}
              </div>
              <div className="artifact-list" role="list" aria-label="Artifact list">
                {selectedSpan.artifacts.map((artifact) => (
                  <button
                    key={artifact.artifactId}
                    type="button"
                    className={`trace-list-item artifact-item${selectedArtifact?.artifact.artifactId === artifact.artifactId ? ' is-active' : ''}`}
                    onClick={() => void handleSelectArtifact(artifact.artifactId)}
                    >
                    <strong>{artifact.name}</strong>
                    <span>{artifact.artifactType}</span>
                    <span>{artifact.summary ?? 'Öffnen, um Rohdaten und decodierte Ansicht zu prüfen'}</span>
                  </button>
                ))}
              </div>
              {selectedArtifact && (
                <section className="artifact-viewer" aria-label="Artifact viewer">
                  {isEncryptedChallengeArtifact(selectedArtifact) && (
                    <p className="section-copy">
                      Rohdaten und Decodiert zeigen das Transport-Envelope, das an den Client zurückgeht. Entschlüsselt zeigt die rekonstruierte Challenge im Klartext.
                    </p>
                  )}
                  <h3>{selectedArtifact.artifact.name}</h3>
                  <p>{selectedArtifact.artifact.explanation}</p>
                  <div className="artifact-block">
                    <span>{isEncryptedChallengeArtifact(selectedArtifact) ? 'Rohes Transport-Envelope' : 'Rohdaten'}</span>
                    <pre>{selectedArtifact.views.raw}</pre>
                  </div>
                  <div className="artifact-block">
                    <span>{isEncryptedChallengeArtifact(selectedArtifact) ? 'Decodiertes Transport-Envelope' : 'Decodiert'}</span>
                    <pre>{formatArtifactView(selectedArtifact.views.decoded, 'Keine decodierte Ansicht verfügbar.')}</pre>
                  </div>
                  <div className="artifact-block">
                    <span>{isEncryptedChallengeArtifact(selectedArtifact) ? 'Entschlüsselte Payload' : 'Entschlüsselt'}</span>
                    <pre>{formatArtifactView(selectedArtifact.views.decrypted, 'Kein entschlüsselter Klartext verfügbar.')}</pre>
                  </div>
                  <div className="artifact-block">
                    <span>Erläutert</span>
                    <div className="explanation-list">
                      {selectedArtifact.views.explained.map((field) => (
                        <article key={field.fieldPath}>
                          <strong>{field.label}</strong>
                          <p>{field.fieldPath}</p>
                          <p>{field.explanation}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}
        </article>
      </section>

      <section className="card proxy-log-panel">
        <h2>Proxy-Hops</h2>
        <p className="section-copy">Caddy-Access-Logs mit derselben Correlation-ID bleiben hier zusammen mit den rohen Trace-Daten sichtbar.</p>
        {!proxyLogs.length && <p>Für diesen Trace wurden keine passenden Caddy-Proxy-Logs geladen.</p>}
        <div className="artifact-list" role="list" aria-label="Proxy log list">
          {proxyLogs.map((entry, index) => (
            <article key={`${entry.ts ?? 'proxy'}-${index}`} className="trace-list-item proxy-log-entry">
              <strong>{entry.host ?? 'unknown-host'}</strong>
              <span>{formatTimestamp(entry.ts)}</span>
              <span>{entry.request?.method ?? 'GET'} {entry.request?.uri ?? '/'}</span>
              <span>upstream: {entry.upstream_host ?? 'static'}</span>
              <span>correlation: {entry.correlation_id ?? 'missing'}</span>
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

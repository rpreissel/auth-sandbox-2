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

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
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
    return 'still running'
  }

  if (value < 1000) {
    return `${value} ms`
  }

  return `${(value / 1000).toFixed(1)} s`
}

function describeTraceActors(trace: TraceListItem) {
  return trace.actors.length ? trace.actors.join(' -> ') : 'No actors recorded'
}

function describeSpanTarget(span: TraceDetailResponse['spans'][number]) {
  return span.route ?? span.method ?? span.url ?? span.targetName ?? null
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
      const haystack = [trace.title, trace.traceType, trace.status, trace.actors.join(' ')].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [traceQuery, traces])

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
      codes={codes}
      devices={devices}
      form={form}
      onCreate={handleCreate}
      onOpenTraceBrowser={() => navigateToRoute({ name: 'trace-browser' })}
      setForm={setForm}
    />
  )
}

function AdminOverviewPage(props: {
  codes: RegistrationCodeRecord[]
  devices: DeviceRecord[]
  form: { userId: string; displayName: string; validForDays: number }
  onCreate: (event: FormEvent) => Promise<void>
  onOpenTraceBrowser: () => void
  setForm: (next: { userId: string; displayName: string; validForDays: number }) => void
}) {
  return (
    <main className="shell">
      <section className="card hero">
        <p className="eyebrow">Admin Web</p>
        <h1>Create registration codes, inspect devices, and open the dedicated trace browser.</h1>
        <div className="button-row">
          <button type="button" onClick={props.onOpenTraceBrowser}>Open trace browser</button>
        </div>
      </section>

      <section className="card trace-entry-card">
        <p className="eyebrow">Trace Explorer</p>
        <h2>A separate trace browser keeps observability out of the admin CRUD screen.</h2>
        <p className="section-copy">Open the browser page to scan long trace lists, keep the selected summary visible, and dive into the full inspector only when needed.</p>
      </section>

      <section className="card">
        <h2>Create registration code</h2>
        <form className="grid" onSubmit={props.onCreate}>
          <label>
            User ID
            <input value={props.form.userId} onChange={(event) => props.setForm({ ...props.form, userId: event.target.value })} />
          </label>
          <label>
            Display name
            <input value={props.form.displayName} onChange={(event) => props.setForm({ ...props.form, displayName: event.target.value })} />
          </label>
          <label>
            Valid for days
            <input type="number" value={props.form.validForDays} onChange={(event) => props.setForm({ ...props.form, validForDays: Number(event.target.value) })} />
          </label>
          <button type="submit">Create code</button>
        </form>
      </section>

      <section className="card list-card">
        <h2>Registration codes</h2>
        <div className="list">
          {props.codes.map((code) => (
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
          {props.devices.map((device) => (
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
            <p className="eyebrow">Trace Browser</p>
            <h1>Scan flows quickly, keep the selected summary visible, and open deep inspection only when needed.</h1>
          </div>
          <button type="button" className="secondary-button" onClick={props.onBack}>Back to admin</button>
        </div>
        <p className="trace-warning">Demo mode captures all payloads, including sensitive values, encrypted blobs, and decoded JWT claims.</p>
      </section>

      <section className="trace-browser-layout trace-browser-layout-wide">
        <aside className="card trace-column trace-list-card">
          <div className="trace-column-header">
            <div>
              <h2>Traces</h2>
              <p className="section-copy">Use search to cut down long lists. The selected trace stays visible on the right.</p>
            </div>
            <button type="button" onClick={props.onRefresh}>Reload</button>
          </div>
          <label className="trace-search">
            Search traces
            <input
              aria-label="Search traces"
              placeholder="Search title, actor, status"
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
                    <span className={`trace-status-chip trace-status-${trace.status}`}>{trace.status}</span>
                  </div>
                  <span className="trace-list-timestamp">Started {formatTimestamp(trace.startedAt)}</span>
                  <span>{describeTraceActors(trace)}</span>
                  <div className="trace-chip-row">
                    <span className="trace-chip">{trace.traceType}</span>
                    <span className="trace-chip">{trace.spanCount} spans</span>
                    <span className="trace-chip">{formatDuration(trace.durationMs)}</span>
                    {trace.errorCount > 0 && <span className="trace-chip trace-chip-alert">{trace.errorCount} errors</span>}
                  </div>
                </button>
              )
            })}
            {!props.filteredTraces.length && <p>No traces match the current search.</p>}
          </div>
        </aside>

        <section ref={props.detailRef} className="card trace-column trace-browser-detail-card">
          <div className="trace-column-header">
            <div>
              <h2>Selected trace</h2>
              <p className="section-copy">Browse the high-level flow here. Open the inspector page for artifacts, proxy hops, and span payloads.</p>
            </div>
            {props.selectedTrace && (
              <button type="button" onClick={() => props.onOpenDetail(props.selectedTrace!.trace.traceId)}>
                Open deep inspection
              </button>
            )}
          </div>
          {props.traceLoading && <p>Loading trace...</p>}
          {!props.selectedTrace && !props.traceLoading && <p>Select a trace from the list to keep its summary and process flow in view.</p>}
          {props.selectedTrace && (
            <div className="trace-detail trace-browser-detail">
              <div className="trace-summary-grid">
                <article><span>Trace ID</span><strong>{props.selectedTrace.trace.traceId}</strong></article>
                <article><span>Correlation</span><strong>{props.selectedTrace.trace.correlationId}</strong></article>
                <article><span>Status</span><strong>{props.selectedTrace.trace.status}</strong></article>
                <article><span>Started</span><strong>{formatTimestamp(props.selectedTrace.trace.startedAt)}</strong></article>
                <article><span>Duration</span><strong>{formatDuration(props.selectedTrace.trace.durationMs)}</strong></article>
              </div>
              <section className="trace-browser-story">
                <h3>What happened</h3>
                <p>{props.selectedTrace.trace.summary}</p>
                <div className="trace-chip-row" aria-label="Actor lanes">
                  {props.selectedTrace.lanes.map((lane) => (
                    <span key={`${lane.actorType}-${lane.actorName}`} className="trace-chip">
                      {lane.actorName}
                    </span>
                  ))}
                </div>
              </section>
              <section className="trace-browser-story">
                <h3>Timeline</h3>
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
                          <span className={`trace-status-chip trace-status-${span.status}`}>{span.status}</span>
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
          setLoadError(error instanceof Error ? error.message : 'Failed to load trace detail.')
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
            <p className="eyebrow">Trace Inspector</p>
            <h1>{traceDetail?.trace.title ?? 'Deep trace inspection'}</h1>
          </div>
          <button type="button" className="secondary-button" onClick={props.onBack}>Back to trace browser</button>
        </div>
        <p className="trace-warning">This page focuses on span-level requests, responses, decoded payloads, decrypted challenge data, and proxy hops.</p>
      </section>

      <section className="trace-inspector-layout">
        <article className="card trace-column">
          <h2>Trace detail</h2>
          {traceLoading && <p>Loading trace...</p>}
          {loadError && <p>{loadError}</p>}
          {!traceDetail && !traceLoading && !loadError && <p>Select a trace from the browser page first.</p>}
          {traceDetail && (
            <div className="trace-detail">
              <div className="trace-summary-grid">
                <article><span>Trace ID</span><strong>{traceDetail.trace.traceId}</strong></article>
                <article><span>Correlation</span><strong>{traceDetail.trace.correlationId}</strong></article>
                <article><span>Status</span><strong>{traceDetail.trace.status}</strong></article>
                <article><span>Actor lanes</span><strong>{traceDetail.lanes.map((lane) => lane.actorName).join(', ')}</strong></article>
              </div>
              <p>{traceDetail.trace.summary}</p>
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
                      <span>{span.kind}</span>
                      <span>{span.status}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </article>

        <article className="card trace-column">
          <h2>Span and artifact detail</h2>
          {!selectedSpan && <p>Select a span to inspect requests, responses, decoded JWTs, and encrypted challenge data.</p>}
          {selectedSpan && (
            <div className="trace-detail">
              <div className="trace-summary-grid compact-grid">
                <article><span>Span</span><strong>{selectedSpan.span.operation}</strong></article>
                <article><span>Actor</span><strong>{selectedSpan.span.actorName}</strong></article>
                <article><span>Kind</span><strong>{selectedSpan.span.kind}</strong></article>
                <article><span>Status</span><strong>{selectedSpan.span.status}</strong></article>
              </div>
              <p>{selectedSpan.span.notes}</p>
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
                    <span>{artifact.summary ?? 'Open to inspect raw and decoded views'}</span>
                  </button>
                ))}
              </div>
              {selectedArtifact && (
                <section className="artifact-viewer" aria-label="Artifact viewer">
                  {isEncryptedChallengeArtifact(selectedArtifact) && (
                    <p className="section-copy">
                      Raw and Decoded show the transport envelope returned to the client. Decrypted shows the reconstructed plaintext challenge payload.
                    </p>
                  )}
                  <h3>{selectedArtifact.artifact.name}</h3>
                  <p>{selectedArtifact.artifact.explanation}</p>
                  <div className="artifact-block">
                    <span>{isEncryptedChallengeArtifact(selectedArtifact) ? 'Raw Envelope' : 'Raw'}</span>
                    <pre>{selectedArtifact.views.raw}</pre>
                  </div>
                  <div className="artifact-block">
                    <span>{isEncryptedChallengeArtifact(selectedArtifact) ? 'Decoded Envelope' : 'Decoded'}</span>
                    <pre>{formatArtifactView(selectedArtifact.views.decoded, 'No decoded view available.')}</pre>
                  </div>
                  <div className="artifact-block">
                    <span>{isEncryptedChallengeArtifact(selectedArtifact) ? 'Decrypted Payload' : 'Decrypted'}</span>
                    <pre>{formatArtifactView(selectedArtifact.views.decrypted, 'No decrypted plaintext available.')}</pre>
                  </div>
                  <div className="artifact-block">
                    <span>Explained</span>
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
        <h2>Proxy hops</h2>
        <p className="section-copy">Caddy access log entries for the same correlation ID stay on the deep-inspection page with the raw trace data.</p>
        {!proxyLogs.length && <p>No matching Caddy proxy log entries loaded for this trace.</p>}
        <div className="artifact-list" role="list" aria-label="Proxy log list">
          {proxyLogs.map((entry, index) => (
            <article key={`${entry.ts ?? 'proxy'}-${index}`} className="trace-list-item proxy-log-entry">
              <strong>{entry.host ?? 'unknown-host'}</strong>
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

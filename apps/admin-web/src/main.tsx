import { StrictMode, useEffect, useState } from 'react'
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

function AdminApp() {
  const [codes, setCodes] = useState<RegistrationCodeRecord[]>([])
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [traces, setTraces] = useState<TraceListItem[]>([])
  const [selectedTrace, setSelectedTrace] = useState<TraceDetailResponse | null>(null)
  const [selectedSpan, setSelectedSpan] = useState<SpanDetailResponse | null>(null)
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactDetailResponse | null>(null)
  const [proxyLogs, setProxyLogs] = useState<ProxyLogRecord[]>([])
  const [traceLoading, setTraceLoading] = useState(false)
  const [form, setForm] = useState({ userId: 'demo-user', displayName: 'Demo User', validForDays: 30 })

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

  async function handleSelectTrace(traceId: string) {
    setTraceLoading(true)
    try {
      const detail = await request<TraceDetailResponse>(`/api/observability/traces/${traceId}`)
      setSelectedTrace(detail)
      setSelectedSpan(null)
      setSelectedArtifact(null)
      await loadProxyLogs(detail.trace.correlationId)
    } finally {
      setTraceLoading(false)
    }
  }

  async function loadProxyLogs(correlationId: string) {
    try {
      const response = await fetch('/caddy-logs/access.json')
      if (!response.ok) {
        setProxyLogs([])
        return
      }

      const raw = await response.text()
      const matching = raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ProxyLogRecord)
        .filter((entry) => entry.correlation_id === correlationId)
        .slice(-30)
        .reverse()

      setProxyLogs(matching)
    } catch {
      setProxyLogs([])
    }
  }

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

      <section className="card trace-hero">
        <p className="eyebrow">Trace Explorer</p>
        <h2>Demo observability with raw, decoded, decrypted, and explained data.</h2>
        <p className="trace-warning">Demo mode captures all payloads, including sensitive values, encrypted blobs, and decoded JWT claims.</p>
      </section>

      <section className="trace-layout">
        <article className="card trace-column">
          <div className="trace-column-header">
            <h2>Traces</h2>
            <button type="button" onClick={() => void refresh()}>Reload</button>
          </div>
          <div className="trace-list" role="list" aria-label="Trace list">
            {traces.map((trace) => (
              <button
                key={trace.traceId}
                type="button"
                className="trace-list-item"
                onClick={() => void handleSelectTrace(trace.traceId)}
              >
                <strong>{trace.title}</strong>
                <span>{trace.traceType}</span>
                <span>{trace.status}</span>
                <span>{trace.actors.join(' -> ')}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="card trace-column">
          <h2>Trace detail</h2>
          {traceLoading && <p>Loading trace...</p>}
          {!selectedTrace && !traceLoading && <p>Select a trace to inspect its full process tree.</p>}
          {selectedTrace && (
            <div className="trace-detail">
              <div className="trace-summary-grid">
                <article><span>Trace ID</span><strong>{selectedTrace.trace.traceId}</strong></article>
                <article><span>Correlation</span><strong>{selectedTrace.trace.correlationId}</strong></article>
                <article><span>Status</span><strong>{selectedTrace.trace.status}</strong></article>
                <article><span>Actor lanes</span><strong>{selectedTrace.lanes.map((lane) => lane.actorName).join(', ')}</strong></article>
              </div>
              <p>{selectedTrace.trace.summary}</p>
              <div className="trace-timeline" role="list" aria-label="Trace spans timeline">
                {selectedTrace.spans.map((span) => (
                  <button
                    key={span.spanId}
                    type="button"
                    className="trace-span-item"
                    onClick={() => void handleSelectSpan(span.spanId)}
                  >
                    <strong>{span.actorName}</strong>
                    <span>{span.operation}</span>
                    <span>{span.kind}</span>
                    <span>{span.status}</span>
                  </button>
                ))}
              </div>
              <section className="proxy-log-panel">
                <h3>Proxy hops</h3>
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
                    className="trace-list-item artifact-item"
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
                  <h3>{selectedArtifact.artifact.name}</h3>
                  <p>{selectedArtifact.artifact.explanation}</p>
                  <div className="artifact-block">
                    <span>Raw</span>
                    <pre>{selectedArtifact.views.raw}</pre>
                  </div>
                  <div className="artifact-block">
                    <span>Decoded</span>
                    <pre>{JSON.stringify(selectedArtifact.views.decoded, null, 2)}</pre>
                  </div>
                  <div className="artifact-block">
                    <span>Decrypted</span>
                    <pre>{JSON.stringify(selectedArtifact.views.decrypted, null, 2)}</pre>
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
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>
)

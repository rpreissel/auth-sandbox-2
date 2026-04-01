import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type {
  ArtifactDetailResponse,
  SpanDetailResponse,
  TraceDetailResponse,
  TraceListItem,
  TraceListResponse
} from '@auth-sandbox-2/shared-types'

import './styles.css'

const API_BASE = import.meta.env.VITE_TRACE_API_URL ?? '/trace-api'
const ADMIN_WEB_URL = 'https://admin.localhost:8443'
const TRACE_DETAIL_PREFIX = '#trace/'

type ProxyLogRecord = {
  ts?: string
  request?: {
    method?: string
    uri?: string
  }
  host?: string
  correlation_id?: string
  trace_hint?: string
  upstream_host?: string
}

type Route =
  | { name: 'trace-browser' }
  | { name: 'trace-detail'; traceId: string }

function createTraceHeaders() {
  const traceId = crypto.randomUUID()
  return {
    'x-trace-id': traceId,
    'x-correlation-id': traceId,
    'x-client-name': 'trace-web'
  }
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...createTraceHeaders(),
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

  return { name: 'trace-browser' }
}

function navigateToRoute(route: Route) {
  if (route.name === 'trace-detail') {
    window.location.hash = `${TRACE_DETAIL_PREFIX}${encodeURIComponent(route.traceId)}`
    return
  }

  if (window.location.hash) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
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
      return 'laeuft'
    case 'success':
      return 'erfolgreich'
    case 'error':
      return 'fehlerhaft'
    default:
      return status
  }
}

type NestedArtifactEntry = {
  source: string
  encoding?: string
  value: unknown
}

type CompositeArtifactView = {
  value?: unknown
  nestedDecoded: NestedArtifactEntry[]
  nestedDecrypted: NestedArtifactEntry[]
}

type ArtifactSection = {
  id: string
  title: string
  text: string
  rows: number
}

type ArtifactSectionsProps = {
  sections: ArtifactSection[]
}

function formatArtifactScalar(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

function getValueFieldRows(value: unknown) {
  const text = formatArtifactScalar(value)
  const lineCount = text.split('\n').length
  return Math.min(18, Math.max(4, lineCount))
}

function ArtifactSections(props: ArtifactSectionsProps) {
  return (
    <div className="artifact-json-sections">
      {props.sections.map((section) => (
        <section key={section.id} className="artifact-json-section">
          <div className="artifact-json-section-header">
            <strong>{section.title}</strong>
          </div>
          <textarea className="artifact-json-field" readOnly value={section.text} rows={section.rows} />
        </section>
      ))}
    </div>
  )
}

function parseCompositeArtifactView(value: unknown): CompositeArtifactView | null {
  if (!isRecord(value)) {
    return null
  }

  const nestedDecoded = parseNestedArtifactEntries(value.nestedDecoded)
  const nestedDecrypted = parseNestedArtifactEntries(value.nestedDecrypted)
  const hasCompositeShape = 'value' in value || nestedDecoded.length > 0 || nestedDecrypted.length > 0

  if (!hasCompositeShape) {
    return null
  }

  return {
    value: value.value,
    nestedDecoded,
    nestedDecrypted
  }
}

function parseNestedArtifactEntries(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.source !== 'string') {
      return []
    }

    return [{
      source: entry.source,
      encoding: typeof entry.encoding === 'string' ? entry.encoding : undefined,
      value: entry.value
    }]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasDistinctDecodedView(rawView: string, decodedView: unknown) {
  if (decodedView === undefined) {
    return false
  }

  const parsedRawView = parseJsonString(rawView)

  const compositeView = parseCompositeArtifactView(decodedView)
  if (!compositeView) {
    if (parsedRawView !== null) {
      return !isStructurallyEqual(parsedRawView, decodedView)
    }

    return formatArtifactScalar(decodedView) !== rawView
  }

  if (compositeView.nestedDecoded.length > 0 || compositeView.nestedDecrypted.length > 0) {
    return true
  }

  if (compositeView.value === undefined) {
    return false
  }

  if (parsedRawView !== null) {
    return !isStructurallyEqual(parsedRawView, compositeView.value)
  }

  return formatArtifactScalar(compositeView.value) !== rawView
}

function createArtifactSections(artifact: ArtifactDetailResponse) {
  const sections: ArtifactSection[] = [{
    id: 'raw',
    title: 'Rohdaten',
    text: formatArtifactScalar(parseJsonString(artifact.views.raw) ?? artifact.views.raw),
    rows: getValueFieldRows(parseJsonString(artifact.views.raw) ?? artifact.views.raw)
  }]

  const decodedComposite = parseCompositeArtifactView(artifact.views.decoded)
  if (hasDistinctDecodedView(artifact.views.raw, artifact.views.decoded)) {
    if (decodedComposite) {
      if (decodedComposite.value !== undefined) {
        sections.push({
          id: 'decoded',
          title: 'Decodiert',
          text: formatArtifactScalar(decodedComposite.value),
          rows: getValueFieldRows(decodedComposite.value)
        })
      }

      decodedComposite.nestedDecoded.forEach((entry, index) => {
        sections.push({
          id: `nested-decoded-${index}`,
          title: `Verschachtelt decodiert: ${entry.source}`,
          text: formatArtifactScalar(entry.value),
          rows: getValueFieldRows(entry.value)
        })
      })

      decodedComposite.nestedDecrypted.forEach((entry, index) => {
        sections.push({
          id: `nested-decrypted-${index}`,
          title: `Verschachtelt entschluesselt: ${entry.source}`,
          text: formatArtifactScalar(entry.value),
          rows: getValueFieldRows(entry.value)
        })
      })
    } else {
      sections.push({
        id: 'decoded',
        title: 'Decodiert',
        text: formatArtifactScalar(artifact.views.decoded),
        rows: getValueFieldRows(artifact.views.decoded)
      })
    }
  }

  sections.push({
    id: 'decrypted',
    title: 'Entschluesselt',
    text: formatArtifactScalar(artifact.views.decrypted ?? 'Kein entschluesselter Klartext verfuegbar.'),
    rows: getValueFieldRows(artifact.views.decrypted ?? 'Kein entschluesselter Klartext verfuegbar.')
  })

  return sections
}

function parseJsonString(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isStructurallyEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => isStructurallyEqual(entry, right[index]))
  }

  if (!isRecord(left) || !isRecord(right)) {
    return false
  }

  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()

  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && isStructurallyEqual(left[key], right[key]))
}

function summarizeSpan(span: TraceDetailResponse['spans'][number]) {
  return [span.actorName, span.kind, span.status].join(' - ')
}

function formatDuration(value: number | null) {
  if (value === null) {
    return 'laeuft noch'
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
      .filter((entry) => entry.correlation_id === correlationId || entry.trace_hint === correlationId)
      .slice(-30)
      .reverse()
  } catch {
    return []
  }
}

function TraceApp() {
  const [traces, setTraces] = useState<TraceListItem[]>([])
  const [selectedTrace, setSelectedTrace] = useState<TraceDetailResponse | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceQuery, setTraceQuery] = useState('')
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const traceBrowserDetailRef = useRef<HTMLElement | null>(null)

  async function refresh() {
    const tracesResult = await request<TraceListResponse>('/traces?page=1&pageSize=30')
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

  async function handlePreviewTrace(traceId: string) {
    setTraceLoading(true)
    try {
      const detail = await request<TraceDetailResponse>(`/traces/${traceId}`)
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

  return (
    <TraceBrowserPage
      detailRef={traceBrowserDetailRef}
      filteredTraces={filteredTraces}
      selectedTrace={selectedTrace}
      traceLoading={traceLoading}
      traceQuery={traceQuery}
      onBack={() => window.location.assign(ADMIN_WEB_URL)}
      onChangeQuery={setTraceQuery}
      onOpenDetail={(traceId) => navigateToRoute({ name: 'trace-detail', traceId })}
      onRefresh={() => void refresh()}
      onSelectTrace={(traceId) => void handlePreviewTrace(traceId)}
    />
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
            <p className="eyebrow">Trace-Viewer</p>
            <h1>Behalte den ausgewaehlten Trace im Blick und öffne die Detailinspektion nur dann, wenn du tiefer einsteigen willst.</h1>
          </div>
          <button type="button" className="secondary-button" onClick={props.onBack}>Zurück zur Admin-App</button>
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
                name="traceQuery"
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
              <button type="button" onClick={() => props.onOpenDetail(props.selectedTrace?.trace.traceId ?? '')}>
                Detailinspektion öffnen
              </button>
            )}
          </div>
          {props.traceLoading && <p>Trace wird geladen...</p>}
          {!props.selectedTrace && !props.traceLoading && <p>Waehle links einen Trace aus, um Zusammenfassung und Ablauf im Blick zu behalten.</p>}
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
  const [artifactLoading, setArtifactLoading] = useState(false)
  const [proxyLogs, setProxyLogs] = useState<ProxyLogRecord[]>([])
  const [traceLoading, setTraceLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadTrace() {
      setTraceLoading(true)
      setLoadError(null)

      try {
        const detail = await request<TraceDetailResponse>(`/traces/${props.traceId}`)
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
    const detail = await request<SpanDetailResponse>(`/spans/${spanId}`)
    setSelectedSpan(detail)

    const initialArtifactId = detail.artifacts[0]?.artifactId
    if (!initialArtifactId) {
      setSelectedArtifact(null)
      return
    }

    setArtifactLoading(true)
    try {
      const initialArtifact = await request<ArtifactDetailResponse>(`/artifacts/${initialArtifactId}`)
      setSelectedArtifact(initialArtifact)
    } finally {
      setArtifactLoading(false)
    }
  }

  async function handleSelectArtifact(artifactId: string) {
    setArtifactLoading(true)
    const detail = await request<ArtifactDetailResponse>(`/artifacts/${artifactId}`)
    try {
      setSelectedArtifact(detail)
    } finally {
      setArtifactLoading(false)
    }
  }

  return (
    <main className="shell">
      <section className="card trace-hero trace-detail-hero">
        <div className="trace-column-header">
          <div>
            <p className="eyebrow">Trace-Inspektor</p>
            <h1>{formatTraceInspectorHeading(traceDetail?.trace)}</h1>
          </div>
          <button type="button" className="secondary-button" onClick={props.onBack}>Zurück zum Trace-Viewer</button>
        </div>
        {traceDetail && <p className="section-copy">{traceDetail.trace.title}</p>}
        <p className="trace-warning">Diese Seite zeigt Requests und Responses je Span, decodierte Payloads, entschlüsselte Challenge-Daten und die dazugehörigen Proxy-Hops.</p>
      </section>

      <section className="trace-inspector-layout">
        <article className="card trace-column">
          <h2>Trace-Details</h2>
          {traceLoading && <p>Trace wird geladen...</p>}
          {loadError && <p>{loadError}</p>}
          {!traceDetail && !traceLoading && !loadError && <p>Waehle zuerst im Trace-Viewer einen Trace aus.</p>}
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
          {!selectedSpan && <p>Waehle einen Span aus, um Requests, Responses, decodierte JWTs und die verschlüsselte Challenge näher zu prüfen.</p>}
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
              <div className="artifact-tab-bar" role="tablist" aria-label="Artifact quick access">
                {selectedSpan.artifacts.map((artifact) => (
                  <button
                    key={artifact.artifactId}
                    type="button"
                    role="tab"
                    aria-selected={selectedArtifact?.artifact.artifactId === artifact.artifactId}
                    className={`artifact-tab${selectedArtifact?.artifact.artifactId === artifact.artifactId ? ' is-active' : ''}`}
                    onClick={() => void handleSelectArtifact(artifact.artifactId)}
                  >
                    <strong>{artifact.name}</strong>
                    <span>{artifact.artifactType}</span>
                  </button>
                ))}
              </div>
              {artifactLoading && <p>Artefakt wird geladen...</p>}
              {selectedArtifact && !artifactLoading && (
                <section className="artifact-viewer" aria-label="Artifact viewer">
                  <h3>{selectedArtifact.artifact.name}</h3>
                  <p>{selectedArtifact.artifact.explanation}</p>
                  <ArtifactSections sections={createArtifactSections(selectedArtifact)} />
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
              <span>trace hint: {entry.trace_hint ?? 'missing'}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TraceApp />
  </StrictMode>
)

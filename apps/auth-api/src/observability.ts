import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import type { PoolClient, QueryResultRow } from 'pg'

import type {
  ActorType,
  ArtifactDetailResponse,
  ArtifactSummary,
  ClientEventArtifactInput,
  ClientEventInput,
  FieldExplanation,
  SpanDetailResponse,
  SpanKind,
  TraceDetailResponse,
  TraceListResponse,
  TraceStatus
} from '@auth-sandbox-2/shared-types'

import { pool } from './db.js'
import { logger } from './logger.js'

type JsonObject = Record<string, unknown>

type TraceContext = {
  traceId: string
  correlationId: string
  spanId: string | null
  actorName: string
  actorType: ActorType
  userId?: string | null
  deviceId?: string | null
  sessionId?: string | null
  challengeId?: string | null
}

type StartTraceArgs = {
  traceId?: string
  correlationId?: string
  traceType: string
  title: string
  summary?: string | null
  rootClient?: string | null
  rootEntrypoint?: string | null
  userId?: string | null
  deviceId?: string | null
  sessionId?: string | null
}

type StartSpanArgs = {
  traceId?: string
  parentSpanId?: string | null
  kind: SpanKind
  actorType: ActorType
  actorName: string
  operation: string
  method?: string | null
  url?: string | null
  route?: string | null
  targetName?: string | null
  status?: TraceStatus
  statusCode?: number | null
  startedAt?: Date
  userId?: string | null
  deviceId?: string | null
  sessionId?: string | null
  challengeId?: string | null
  notes?: string | null
}

type CompleteSpanArgs = {
  spanId: string
  status: TraceStatus
  statusCode?: number | null
  notes?: string | null
}

type ArtifactRecordInput = {
  spanId: string
  artifactType: string
  name: string
  contentType?: string | null
  encoding?: string | null
  direction?: string | null
  rawValue: string
  explanation?: string | null
}

type TraceListFilters = {
  status?: string
  traceType?: string
  userId?: string
  deviceId?: string
  actorName?: string
  q?: string
  page: number
  pageSize: number
}

type QueryParamValue = string | number

const traceStorage = new AsyncLocalStorage<TraceContext>()
const serviceName = 'auth-api'

export function getTraceContext() {
  return traceStorage.getStore() ?? null
}

export function withTraceContext<T>(context: TraceContext, fn: () => T) {
  return traceStorage.run(context, fn)
}

export function buildTraceContextFromHeaders(headers: Record<string, string | undefined>) {
  const correlationId = headers['x-correlation-id'] ?? randomUUID()
  const traceId = headers['x-trace-id'] ?? correlationId
  const parentSpanId = headers['x-span-id'] ?? null
  const sessionId = headers['x-session-id'] ?? null

  return {
    traceId,
    correlationId,
    parentSpanId,
    sessionId
  }
}

export function buildTraceHeaders(overrides?: Partial<Pick<TraceContext, 'traceId' | 'correlationId' | 'sessionId'>> & { spanId?: string | null }) {
  const context = getTraceContext()
  const traceId = overrides?.traceId ?? context?.traceId ?? randomUUID()
  const correlationId = overrides?.correlationId ?? context?.correlationId ?? traceId
  const spanId = overrides?.spanId ?? context?.spanId ?? null
  const headers: Record<string, string> = {
    'x-trace-id': traceId,
    'x-correlation-id': correlationId
  }

  if (spanId) {
    headers['x-span-id'] = spanId
  }

  const sessionId = overrides?.sessionId ?? context?.sessionId ?? null
  if (sessionId) {
    headers['x-session-id'] = sessionId
  }

  return headers
}

export async function ensureTrace(args: StartTraceArgs) {
  const traceId = args.traceId ?? randomUUID()
  const correlationId = args.correlationId ?? traceId

  await pool.query(
    `insert into observability.traces (
      trace_id,
      correlation_id,
      trace_type,
      status,
      root_client,
      root_entrypoint,
      user_id,
      device_id,
      session_id,
      title,
      summary
    ) values ($1, $2, $3, 'running', $4, $5, $6, $7, $8, $9, $10)
    on conflict (trace_id) do update set
      correlation_id = excluded.correlation_id,
      trace_type = excluded.trace_type,
      root_client = coalesce(observability.traces.root_client, excluded.root_client),
      root_entrypoint = coalesce(observability.traces.root_entrypoint, excluded.root_entrypoint),
      user_id = coalesce(observability.traces.user_id, excluded.user_id),
      device_id = coalesce(observability.traces.device_id, excluded.device_id),
      session_id = coalesce(observability.traces.session_id, excluded.session_id),
      title = excluded.title,
      summary = excluded.summary`,
    [
      traceId,
      correlationId,
      args.traceType,
      args.rootClient ?? null,
      args.rootEntrypoint ?? null,
      args.userId ?? null,
      args.deviceId ?? null,
      args.sessionId ?? null,
      args.title,
      args.summary ?? null
    ]
  )

  return { traceId, correlationId }
}

export async function startSpan(args: StartSpanArgs) {
  const context = getTraceContext()
  const traceId = args.traceId ?? context?.traceId
  if (!traceId) {
    throw new Error('Cannot start span without traceId')
  }

  const spanId = randomUUID()
  const startedAt = args.startedAt ?? new Date()

  await pool.query(
    `insert into observability.spans (
      span_id,
      trace_id,
      parent_span_id,
      kind,
      actor_type,
      actor_name,
      target_name,
      operation,
      method,
      url,
      route,
      status,
      status_code,
      started_at,
      user_id,
      device_id,
      session_id,
      challenge_id,
      notes
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      spanId,
      traceId,
      args.parentSpanId ?? context?.spanId ?? null,
      args.kind,
      args.actorType,
      args.actorName,
      args.targetName ?? null,
      args.operation,
      args.method ?? null,
      args.url ?? null,
      args.route ?? null,
      args.status ?? 'running',
      args.statusCode ?? null,
      startedAt.toISOString(),
      args.userId ?? context?.userId ?? null,
      args.deviceId ?? context?.deviceId ?? null,
      args.sessionId ?? context?.sessionId ?? null,
      args.challengeId ?? context?.challengeId ?? null,
      args.notes ?? null
    ]
  )

  return { spanId, traceId, startedAt }
}

export async function completeSpan(args: CompleteSpanArgs) {
  await pool.query(
    `update observability.spans
      set status = $2,
          status_code = coalesce($3, status_code),
          notes = coalesce($4, notes),
          finished_at = now(),
          duration_ms = greatest(0, floor(extract(epoch from (now() - started_at)) * 1000))::integer
      where span_id = $1`,
    [args.spanId, args.status, args.statusCode ?? null, args.notes ?? null]
  )
}

export async function completeTrace(traceId: string, status: TraceStatus, summary?: string | null) {
  await pool.query(
    `update observability.traces
      set status = $2,
          summary = coalesce($3, summary),
          finished_at = now()
      where trace_id = $1`,
    [traceId, status, summary ?? null]
  )
}

export async function recordArtifact(input: ArtifactRecordInput) {
  const artifactId = randomUUID()
  const derived = decodeArtifact(input.rawValue, input.encoding, input.contentType)
  const explanation = input.explanation ?? derived.explanation ?? null

  await pool.query(
    `insert into observability.artifacts (
      artifact_id,
      span_id,
      artifact_type,
      name,
      content_type,
      encoding,
      direction,
      raw_value,
      derived_value,
      explanation
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      artifactId,
      input.spanId,
      input.artifactType,
      input.name,
      input.contentType ?? null,
      input.encoding ?? null,
      input.direction ?? null,
      input.rawValue,
      JSON.stringify(derived.derivedValue),
      explanation
    ]
  )

  for (const field of derived.fields) {
    await pool.query(
      `insert into observability.field_explanations (
        explanation_id,
        artifact_id,
        field_path,
        label,
        raw_value,
        normalized_value,
        explanation
      ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), artifactId, field.fieldPath, field.label, field.rawValue, field.normalizedValue, field.explanation]
    )
  }

  return artifactId
}

export async function recordArtifacts(spanId: string, artifacts: ClientEventArtifactInput[]) {
  for (const artifact of artifacts) {
    await recordArtifact({
      spanId,
      artifactType: artifact.artifactType,
      name: artifact.name,
      contentType: artifact.contentType ?? null,
      encoding: artifact.encoding ?? null,
      direction: artifact.direction ?? null,
      rawValue: artifact.rawValue,
      explanation: artifact.explanation ?? null
    })
  }
}

export async function ingestClientEvent(event: ClientEventInput) {
  const trace = await ensureTrace({
    traceId: event.traceId,
    correlationId: event.traceId,
    traceType: event.traceType ?? 'client_event',
    title: `${event.actorName} ${event.operation}`,
    summary: 'Client-side trace event captured for demo observability.',
    rootClient: event.actorName,
    userId: event.userId ?? null,
    deviceId: event.deviceId ?? null,
    sessionId: event.sessionId ?? null
  })

  const startedAt = event.timestamp ? new Date(event.timestamp) : new Date()
  const span = await startSpan({
    traceId: trace.traceId,
    parentSpanId: event.parentSpanId ?? null,
    kind: 'client_event',
    actorType: 'client',
    actorName: event.actorName,
    operation: event.operation,
    status: event.status ?? 'success',
    startedAt,
    userId: event.userId ?? null,
    deviceId: event.deviceId ?? null,
    sessionId: event.sessionId ?? null,
    notes: 'Client event recorded by demo trace explorer.'
  })

  if (event.artifacts?.length) {
    await recordArtifacts(span.spanId, event.artifacts)
  }

  await completeSpan({ spanId: span.spanId, status: event.status ?? 'success' })
  return { traceId: trace.traceId, spanId: span.spanId }
}

export async function listTraces(filters: TraceListFilters): Promise<TraceListResponse> {
  const clauses: string[] = []
  const values: QueryParamValue[] = []
  let index = 1

  const addClause = (clause: string, value: QueryParamValue) => {
    clauses.push(clause.replace('?', `$${index}`))
    values.push(value)
    index += 1
  }

  if (filters.status) {
    addClause('t.status = ?', filters.status)
  }
  if (filters.traceType) {
    addClause('t.trace_type = ?', filters.traceType)
  }
  if (filters.userId) {
    addClause('t.user_id = ?', filters.userId)
  }
  if (filters.deviceId) {
    addClause('t.device_id = ?', filters.deviceId)
  }
  if (filters.q) {
    clauses.push(`(t.correlation_id ilike $${index} or t.title ilike $${index + 1})`)
    values.push(`%${filters.q}%`, `%${filters.q}%`)
    index += 2
  }
  if (filters.actorName) {
    addClause('exists (select 1 from observability.spans s where s.trace_id = t.trace_id and s.actor_name = ?)', filters.actorName)
  }

  const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
  const offset = (filters.page - 1) * filters.pageSize
  const countResult = await pool.query<{ total: string }>(`select count(*)::text as total from observability.traces t ${where}`, values)
  const rows = await pool.query<{
    trace_id: string
    correlation_id: string
    trace_type: string
    title: string
    status: TraceStatus
    started_at: string
    finished_at: string | null
    duration_ms: number | null
    root_client: string | null
    root_entrypoint: string | null
    user_id: string | null
    device_id: string | null
    span_count: string
    error_count: string
    actors: string[] | null
  }>(
    `select
      t.trace_id,
      t.correlation_id,
      t.trace_type,
      t.title,
      t.status,
      t.started_at,
      t.finished_at,
      case
        when t.finished_at is null then null
        else greatest(0, floor(extract(epoch from (t.finished_at - t.started_at)) * 1000))::integer
      end as duration_ms,
      t.root_client,
      t.root_entrypoint,
      t.user_id,
      t.device_id,
      count(s.span_id)::text as span_count,
      count(*) filter (where s.status = 'error')::text as error_count,
      array_remove(array_agg(distinct s.actor_name), null) as actors
    from observability.traces t
    left join observability.spans s on s.trace_id = t.trace_id
    ${where}
    group by t.trace_id
    order by t.started_at desc
    limit $${index} offset $${index + 1}`,
    [...values, filters.pageSize, offset]
  )

  return {
    items: rows.rows.map((row) => ({
      traceId: row.trace_id,
      correlationId: row.correlation_id,
      traceType: row.trace_type,
      title: row.title,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      rootClient: row.root_client,
      rootEntrypoint: row.root_entrypoint,
      userId: row.user_id,
      deviceId: row.device_id,
      spanCount: Number(row.span_count),
      errorCount: Number(row.error_count),
      actors: row.actors ?? []
    })),
    page: filters.page,
    pageSize: filters.pageSize,
    total: Number(countResult.rows[0]?.total ?? 0)
  }
}

export async function getTraceDetail(traceId: string): Promise<TraceDetailResponse | null> {
  const traceResult = await pool.query<{
    trace_id: string
    correlation_id: string
    trace_type: string
    status: TraceStatus
    title: string
    summary: string | null
    started_at: string
    finished_at: string | null
    duration_ms: number | null
    root_client: string | null
    root_entrypoint: string | null
    user_id: string | null
    device_id: string | null
    session_id: string | null
  }>(
    `select
      trace_id,
      correlation_id,
      trace_type,
      status,
      title,
      summary,
      started_at,
      finished_at,
      case
        when finished_at is null then null
        else greatest(0, floor(extract(epoch from (finished_at - started_at)) * 1000))::integer
      end as duration_ms,
      root_client,
      root_entrypoint,
      user_id,
      device_id,
      session_id
    from observability.traces
    where trace_id = $1`,
    [traceId]
  )

  const trace = traceResult.rows[0]
  if (!trace) {
    return null
  }

  const spanResult = await pool.query<{
    span_id: string
    parent_span_id: string | null
    kind: SpanKind
    actor_type: ActorType
    actor_name: string
    operation: string
    method: string | null
    url: string | null
    route: string | null
    target_name: string | null
    status: TraceStatus
    status_code: number | null
    started_at: string
    finished_at: string | null
    duration_ms: number | null
    artifact_count: string
    has_error: boolean
  }>(
    `select
      s.span_id,
      s.parent_span_id,
      s.kind,
      s.actor_type,
      s.actor_name,
      s.operation,
      s.method,
      s.url,
      s.route,
      s.target_name,
      s.status,
      s.status_code,
      s.started_at,
      s.finished_at,
      s.duration_ms,
      count(a.artifact_id)::text as artifact_count,
      bool_or(s.status = 'error') as has_error
    from observability.spans s
    left join observability.artifacts a on a.span_id = s.span_id
    where s.trace_id = $1
    group by s.span_id
    order by s.started_at asc`,
    [traceId]
  )

  const laneMap = new Map<string, { actorType: ActorType; actorName: string }>()
  for (const span of spanResult.rows) {
    laneMap.set(`${span.actor_type}:${span.actor_name}`, {
      actorType: span.actor_type,
      actorName: span.actor_name
    })
  }

  return {
    trace: {
      traceId: trace.trace_id,
      correlationId: trace.correlation_id,
      traceType: trace.trace_type,
      status: trace.status,
      title: trace.title,
      summary: trace.summary,
      startedAt: trace.started_at,
      finishedAt: trace.finished_at,
      durationMs: trace.duration_ms,
      rootClient: trace.root_client,
      rootEntrypoint: trace.root_entrypoint,
      userId: trace.user_id,
      deviceId: trace.device_id,
      sessionId: trace.session_id
    },
    lanes: [...laneMap.values()],
    spans: spanResult.rows.map((span) => ({
      spanId: span.span_id,
      parentSpanId: span.parent_span_id,
      kind: span.kind,
      actorType: span.actor_type,
      actorName: span.actor_name,
      operation: span.operation,
      method: span.method,
      url: span.url,
      route: span.route,
      targetName: span.target_name,
      status: span.status,
      statusCode: span.status_code,
      startedAt: span.started_at,
      finishedAt: span.finished_at,
      durationMs: span.duration_ms,
      artifactCount: Number(span.artifact_count),
      hasError: span.has_error
    }))
  }
}

export async function getSpanDetail(spanId: string): Promise<SpanDetailResponse | null> {
  const spanResult = await pool.query<{
    span_id: string
    trace_id: string
    parent_span_id: string | null
    kind: SpanKind
    actor_type: ActorType
    actor_name: string
    target_name: string | null
    operation: string
    method: string | null
    url: string | null
    route: string | null
    status: TraceStatus
    status_code: number | null
    started_at: string
    finished_at: string | null
    duration_ms: number | null
    user_id: string | null
    device_id: string | null
    session_id: string | null
    challenge_id: string | null
    notes: string | null
  }>('select * from observability.spans where span_id = $1', [spanId])
  const span = spanResult.rows[0]
  if (!span) {
    return null
  }

  const childResult = await pool.query<{ span_id: string }>('select span_id from observability.spans where parent_span_id = $1 order by started_at asc', [spanId])
  const siblingResult = span.parent_span_id
    ? await pool.query<{ span_id: string }>('select span_id from observability.spans where parent_span_id = $1 and span_id <> $2 order by started_at asc', [span.parent_span_id, spanId])
    : { rows: [] }

  const artifactResult = await pool.query<{
    artifact_id: string
    artifact_type: string
    name: string
    encoding: string | null
    content_type: string | null
    direction: string | null
    explanation: string | null
  }>('select artifact_id, artifact_type, name, encoding, content_type, direction, explanation from observability.artifacts where span_id = $1 order by created_at asc', [spanId])

  return {
    span: {
      spanId: span.span_id,
      traceId: span.trace_id,
      parentSpanId: span.parent_span_id,
      kind: span.kind,
      actorType: span.actor_type,
      actorName: span.actor_name,
      targetName: span.target_name,
      operation: span.operation,
      method: span.method,
      url: span.url,
      route: span.route,
      status: span.status,
      statusCode: span.status_code,
      startedAt: span.started_at,
      finishedAt: span.finished_at,
      durationMs: span.duration_ms,
      userId: span.user_id,
      deviceId: span.device_id,
      sessionId: span.session_id,
      challengeId: span.challenge_id,
      notes: span.notes
    },
    relatedSpans: {
      parent: span.parent_span_id,
      children: childResult.rows.map((row) => row.span_id),
      siblings: siblingResult.rows.map((row) => row.span_id)
    },
    artifacts: artifactResult.rows.map<ArtifactSummary>((artifact) => ({
      artifactId: artifact.artifact_id,
      artifactType: artifact.artifact_type,
      name: artifact.name,
      encoding: artifact.encoding,
      contentType: artifact.content_type,
      direction: artifact.direction,
      summary: artifact.explanation
    }))
  }
}

export async function getArtifactDetail(artifactId: string): Promise<ArtifactDetailResponse | null> {
  const artifactResult = await pool.query<{
    artifact_id: string
    span_id: string
    artifact_type: string
    name: string
    content_type: string | null
    encoding: string | null
    direction: string | null
    raw_value: string
    derived_value: unknown
    explanation: string | null
  }>('select * from observability.artifacts where artifact_id = $1', [artifactId])
  const artifact = artifactResult.rows[0]
  if (!artifact) {
    return null
  }

  const fieldsResult = await pool.query<{
    field_path: string
    label: string
    raw_value: string | null
    normalized_value: string | null
    explanation: string
  }>('select field_path, label, raw_value, normalized_value, explanation from observability.field_explanations where artifact_id = $1 order by field_path asc', [artifactId])

  const derivedValue = isRecord(artifact.derived_value) ? artifact.derived_value : null

  const decryptedView = await resolveArtifactDecryptedView(artifact, derivedValue)
  const preparedRawView = prepareArtifactViewForResponse(parseJson(artifact.raw_value))
  const preparedDecodedView = prepareArtifactViewForResponse(derivedValue?.decoded ?? derivedValue)
  const preparedDecryptedView = prepareArtifactViewForResponse(decryptedView)

  return {
    artifact: {
      artifactId: artifact.artifact_id,
      spanId: artifact.span_id,
      artifactType: artifact.artifact_type,
      name: artifact.name,
      contentType: artifact.content_type,
      encoding: artifact.encoding,
      direction: artifact.direction,
      explanation: artifact.explanation
    },
    views: {
      raw: preparedRawView ? JSON.stringify(preparedRawView, null, 2) : artifact.raw_value,
      decoded: normalizeArtifactViewValue(preparedDecodedView),
      decrypted: normalizeArtifactViewValue(preparedDecryptedView),
      explained: fieldsResult.rows.map<FieldExplanation>((field) => ({
        fieldPath: field.field_path,
        label: field.label,
        rawValue: field.raw_value,
        normalizedValue: field.normalized_value,
        explanation: field.explanation
      }))
    }
  }
}

export function createRequestLifecycle(args: {
  method: string
  url: string
  route?: string | null
  traceId: string
  correlationId: string
  parentSpanId?: string | null
  userId?: string | null
  deviceId?: string | null
  sessionId?: string | null
}) {
  return startSpan({
    traceId: args.traceId,
    parentSpanId: args.parentSpanId ?? null,
    kind: 'http_in',
    actorType: 'backend',
    actorName: serviceName,
    operation: `${args.method} ${args.route ?? args.url}`,
    method: args.method,
    url: args.url,
    route: args.route ?? null,
    userId: args.userId ?? null,
    deviceId: args.deviceId ?? null,
    sessionId: args.sessionId ?? null,
    notes: 'Incoming auth-api request captured for demo observability.'
  })
}

export async function runWithSpan<T>(args: StartSpanArgs, fn: (spanId: string) => Promise<T>) {
  const span = await startSpan(args)
  const context = getTraceContext()
  const nextContext: TraceContext = {
    traceId: span.traceId,
    correlationId: context?.correlationId ?? span.traceId,
    spanId: span.spanId,
    actorName: args.actorName,
    actorType: args.actorType,
    userId: args.userId ?? context?.userId ?? null,
    deviceId: args.deviceId ?? context?.deviceId ?? null,
    sessionId: args.sessionId ?? context?.sessionId ?? null,
    challengeId: args.challengeId ?? context?.challengeId ?? null
  }

  return withTraceContext(nextContext, async () => {
    try {
      const result = await fn(span.spanId)
      await completeSpan({ spanId: span.spanId, status: 'success', statusCode: args.statusCode ?? null })
      return result
    } catch (error) {
      await recordArtifact({
        spanId: span.spanId,
        artifactType: 'error',
        name: 'error',
        contentType: 'text/plain',
        encoding: 'raw',
        direction: 'internal',
        rawValue: error instanceof Error ? error.stack ?? error.message : String(error),
        explanation: 'Captured error during trace span execution.'
      })
      await completeSpan({ spanId: span.spanId, status: 'error' })
      throw error
    }
  })
}

export async function getOrCreateClientTrace(args: {
  traceType: string
  correlationId: string
  userId?: string | null
  deviceId?: string | null
  sessionId?: string | null
  title: string
  summary?: string | null
  rootClient?: string | null
  rootEntrypoint?: string | null
}) {
  return ensureTrace({
    traceId: args.correlationId,
    correlationId: args.correlationId,
    traceType: args.traceType,
    title: args.title,
    summary: args.summary ?? null,
    rootClient: args.rootClient ?? null,
    rootEntrypoint: args.rootEntrypoint ?? null,
    userId: args.userId ?? null,
    deviceId: args.deviceId ?? null,
    sessionId: args.sessionId ?? null
  })
}

function decodeArtifact(rawValue: string, encoding?: string | null, contentType?: string | null) {
  const derivedValue: JsonObject = {}
  const fields: FieldExplanation[] = []

  const normalizedEncoding = encoding?.toLowerCase() ?? ''
  const normalizedContentType = contentType?.toLowerCase() ?? ''
  const parsedJson = parseJson(rawValue)

  if (normalizedEncoding === 'jwt' || looksLikeJwt(rawValue)) {
    const decoded = decodeJwt(rawValue)
    derivedValue.decoded = decoded
    derivedValue.decrypted = null
    fields.push(...explainKnownFields(decoded.header, 'header'))
    fields.push(...explainKnownFields(decoded.payload, 'payload'))
    return {
      derivedValue,
      fields,
      explanation: 'JWT token with decoded header and payload.'
    }
  }

  if (normalizedEncoding === 'base64' || normalizedEncoding === 'base64url') {
    const buffer = Buffer.from(rawValue, normalizedEncoding === 'base64url' ? 'base64url' : 'base64')
    const text = buffer.toString('utf8')
    derivedValue.decoded = text
    if (parsedJsonValue(text)) {
      derivedValue.decoded = parsedJsonValue(text)
      fields.push(...explainKnownFields(parsedJsonValue(text), 'decoded'))
    }
    return {
      derivedValue,
      fields,
      explanation: 'Base64 payload decoded for demo inspection.'
    }
  }

  if (normalizedContentType.includes('application/json') || normalizedEncoding === 'json' || parsedJson) {
    const decoded = parsedJson ?? parseJson(rawValue)
    derivedValue.decoded = decoded
    if (decoded) {
      fields.push(...explainKnownFields(decoded, 'body'))
    }
    if (decoded && isEncryptedChallenge(decoded)) {
      derivedValue.decrypted = extractDecryptedValue(decoded)
    }
    return {
      derivedValue,
      fields,
      explanation: 'JSON payload parsed and explained for demo observability.'
    }
  }

  derivedValue.decoded = rawValue
  return {
    derivedValue,
    fields,
    explanation: 'Raw payload stored without additional decoding.'
  }
}

function explainKnownFields(value: unknown, prefix: string): FieldExplanation[] {
  if (!isRecord(value)) {
    return []
  }

  const explanations: FieldExplanation[] = []

  for (const [key, entry] of Object.entries(value)) {
    const fieldPath = `${prefix}.${key}`
    const rawValue = typeof entry === 'string' ? entry : JSON.stringify(entry)
    let label = key
    let explanation = 'Captured field for demo inspection.'
    let normalizedValue = rawValue

    switch (key) {
      case 'sub':
        label = 'Subject'
        explanation = 'Unique user identifier carried in the token or payload.'
        break
      case 'aud':
        label = 'Audience'
        explanation = 'Target audience that should accept this token or payload.'
        break
      case 'iss':
        label = 'Issuer'
        explanation = 'Identity provider or service that created this value.'
        break
      case 'azp':
        label = 'Authorized Party'
        explanation = 'Client application to which the token was issued.'
        break
      case 'exp':
        label = 'Expiration Time'
        explanation = 'Time when the token or challenge expires.'
        normalizedValue = typeof entry === 'number' ? new Date(entry * 1000).toISOString() : rawValue
        break
      case 'iat':
        label = 'Issued At'
        explanation = 'Time when the token or challenge was created.'
        normalizedValue = typeof entry === 'number' ? new Date(entry * 1000).toISOString() : rawValue
        break
      case 'userId':
        label = 'User ID'
        explanation = 'Demo user identifier tied to the device login flow.'
        break
      case 'deviceId':
        label = 'Device ID'
        explanation = 'Registered device identifier for this flow.'
        break
      case 'nonce':
        label = 'Nonce'
        explanation = 'One-time challenge identifier used to bind the flow.'
        break
      case 'encryptedKey':
        label = 'Encrypted Key'
        explanation = 'Wrapped symmetric key used to protect the encrypted challenge payload.'
        break
      case 'encryptedData':
        label = 'Encrypted Data'
        explanation = 'Ciphertext generated for the device login challenge.'
        break
      case 'iv':
        label = 'Initialization Vector'
        explanation = 'IV used together with the encrypted payload.'
        break
      default:
        break
    }

    explanations.push({
      fieldPath,
      label,
      rawValue,
      normalizedValue,
      explanation
    })

    if (isRecord(entry)) {
      explanations.push(...explainKnownFields(entry, fieldPath))
    }
  }

  return explanations
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function parsedJsonValue(value: string) {
  return parseJson(value)
}

function normalizeArtifactViewValue(value: unknown) {
  return value === null ? undefined : value
}

function prepareArtifactViewForResponse(value: unknown): unknown {
  return annotateEpochFields(normalizeChallengeEnvelope(value))
}

function normalizeChallengeEnvelope(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeChallengeEnvelope)
  }

  if (!isRecord(value)) {
    return value
  }

  const hasCipherFields = isDecryptableChallengeEnvelope(value)
  const hasExpiresAt = typeof value.expiresAt === 'string'

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'decrypted')
      .map(([key, entry]) => {
        if (key === 'expiresAt' && hasCipherFields && hasExpiresAt) {
          const epochSeconds = Math.floor(new Date(value.expiresAt as string).getTime() / 1000)
          return ['exp', Number.isNaN(epochSeconds) ? value.expiresAt : epochSeconds]
        }

        return [key, normalizeChallengeEnvelope(entry)]
      })
  )
}

function annotateEpochFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(annotateEpochFields)
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if ((key === 'exp' || key === 'iat') && typeof entry === 'number') {
        return [key, `${entry} /* ${formatEpochComment(entry)} */`]
      }

      return [key, annotateEpochFields(entry)]
    })
  )
}

function formatEpochComment(value: number) {
  return new Date(value * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

function extractDecryptedValue(value: unknown) {
  if (!isRecord(value)) {
    return null
  }

  if ('decrypted' in value) {
    return value.decrypted
  }

  return null
}

async function resolveArtifactDecryptedView(
  artifact: { raw_value: string; name: string },
  derivedValue: JsonObject | null
) {
  const embeddedDecrypted = derivedValue && 'decrypted' in derivedValue ? derivedValue.decrypted : null
  if (embeddedDecrypted !== null && embeddedDecrypted !== undefined && !isDecryptableChallengeEnvelope(embeddedDecrypted)) {
    return embeddedDecrypted
  }

  const decodedValue = derivedValue?.decoded
  const parsedRawValue = parseJson(artifact.raw_value)
  const challengeEnvelope = isDecryptableChallengeEnvelope(decodedValue)
    ? decodedValue
    : isDecryptableChallengeEnvelope(parsedRawValue)
      ? parsedRawValue
      : null

  if (!challengeEnvelope) {
    return embeddedDecrypted
  }

  const storedChallenge = await queryOne<{
    nonce: string
    user_id: string
    device_id: string
    expires_at: string
  }>(
    `select nonce, user_id, device_id, expires_at
       from login_challenges
      where nonce = $1`,
    [challengeEnvelope.nonce]
  )

  if (!storedChallenge) {
    return embeddedDecrypted
  }

  return {
    userId: storedChallenge.user_id,
    nonce: storedChallenge.nonce,
    exp: Math.floor(new Date(storedChallenge.expires_at).getTime() / 1000),
    deviceId: storedChallenge.device_id
  }
}

function isDecryptableChallengeEnvelope(value: unknown): value is {
  nonce: string
  encryptedData?: string
  encryptedKey?: string
  iv?: string
  exp?: number
  expiresAt?: string
} {
  return isRecord(value) && typeof value.nonce === 'string' && (
    typeof value.encryptedData === 'string' ||
    typeof value.encryptedKey === 'string' ||
    typeof value.iv === 'string' ||
    typeof value.exp === 'number'
  )
}

function decodeJwt(token: string) {
  const [header, payload] = token.split('.')
  return {
    header: parseJson(Buffer.from(header, 'base64url').toString('utf8')),
    payload: parseJson(Buffer.from(payload, 'base64url').toString('utf8'))
  }
}

function looksLikeJwt(value: string) {
  return value.split('.').length === 3
}

function isEncryptedChallenge(value: unknown) {
  return isRecord(value) && ('encryptedData' in value || 'encryptedKey' in value || 'nonce' in value)
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null
}

export async function recordHttpExchange(args: {
  spanId: string
  requestHeaders?: HeadersInit | Record<string, string> | null
  requestBody?: string | null
  responseHeaders?: Headers | Record<string, string> | null
  responseBody?: string | null
  requestContentType?: string | null
  responseContentType?: string | null
}) {
  if (args.requestHeaders) {
    await recordArtifact({
      spanId: args.spanId,
      artifactType: 'request_headers',
      name: 'request_headers',
      contentType: 'application/json',
      encoding: 'json',
      direction: 'outbound',
      rawValue: JSON.stringify(normalizeHeaders(args.requestHeaders), null, 2),
      explanation: 'Captured outbound HTTP request headers.'
    })
  }

  if (args.requestBody !== undefined && args.requestBody !== null) {
    await recordArtifact({
      spanId: args.spanId,
      artifactType: 'request_body',
      name: 'request_body',
      contentType: args.requestContentType ?? 'text/plain',
      encoding: inferEncoding(args.requestBody, args.requestContentType),
      direction: 'outbound',
      rawValue: args.requestBody,
      explanation: 'Captured outbound HTTP request body.'
    })
  }

  if (args.responseHeaders) {
    await recordArtifact({
      spanId: args.spanId,
      artifactType: 'response_headers',
      name: 'response_headers',
      contentType: 'application/json',
      encoding: 'json',
      direction: 'inbound',
      rawValue: JSON.stringify(normalizeHeaders(args.responseHeaders), null, 2),
      explanation: 'Captured inbound HTTP response headers.'
    })
  }

  if (args.responseBody !== undefined && args.responseBody !== null) {
    await recordArtifact({
      spanId: args.spanId,
      artifactType: 'response_body',
      name: 'response_body',
      contentType: args.responseContentType ?? 'text/plain',
      encoding: inferEncoding(args.responseBody, args.responseContentType),
      direction: 'inbound',
      rawValue: args.responseBody,
      explanation: 'Captured inbound HTTP response body.'
    })
  }
}

function normalizeHeaders(headers: HeadersInit | Headers | Record<string, string>) {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }

  return headers
}

function inferEncoding(rawValue: string, contentType?: string | null) {
  if (looksLikeJwt(rawValue)) {
    return 'jwt'
  }
  if (contentType?.includes('application/json') || parseJson(rawValue)) {
    return 'json'
  }
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    return 'form-urlencoded'
  }
  return 'raw'
}

export async function withRequestTrace<T>(args: {
  traceType: string
  title: string
  summary?: string | null
  rootClient?: string | null
  rootEntrypoint?: string | null
  correlationId: string
  traceId: string
  sessionId?: string | null
  userId?: string | null
  deviceId?: string | null
  parentSpanId?: string | null
  method: string
  url: string
  route?: string | null
  body?: unknown
  headers?: Record<string, string>
}, fn: (spanId: string) => Promise<T>) {
  const trace = await ensureTrace({
    traceId: args.traceId,
    correlationId: args.correlationId,
    traceType: args.traceType,
    title: args.title,
    summary: args.summary ?? null,
    rootClient: args.rootClient ?? null,
    rootEntrypoint: args.rootEntrypoint ?? null,
    userId: args.userId ?? null,
    deviceId: args.deviceId ?? null,
    sessionId: args.sessionId ?? null
  })

  const lifecycle = await createRequestLifecycle({
    method: args.method,
    url: args.url,
    route: args.route ?? null,
    traceId: trace.traceId,
    correlationId: trace.correlationId,
    parentSpanId: args.parentSpanId ?? null,
    userId: args.userId ?? null,
    deviceId: args.deviceId ?? null,
    sessionId: args.sessionId ?? null
  })

  const context: TraceContext = {
    traceId: trace.traceId,
    correlationId: trace.correlationId,
    spanId: lifecycle.spanId,
    actorName: serviceName,
    actorType: 'backend',
    userId: args.userId ?? null,
    deviceId: args.deviceId ?? null,
    sessionId: args.sessionId ?? null,
    challengeId: null
  }

  if (args.headers) {
    await recordArtifact({
      spanId: lifecycle.spanId,
      artifactType: 'request_headers',
      name: 'incoming_request_headers',
      contentType: 'application/json',
      encoding: 'json',
      direction: 'inbound',
      rawValue: JSON.stringify(args.headers, null, 2),
      explanation: 'Incoming request headers captured by auth-api.'
    })
  }

  if (args.body !== undefined) {
    await recordArtifact({
      spanId: lifecycle.spanId,
      artifactType: 'request_body',
      name: 'incoming_request_body',
      contentType: 'application/json',
      encoding: 'json',
      direction: 'inbound',
      rawValue: JSON.stringify(args.body, null, 2),
      explanation: 'Incoming request body captured by auth-api.'
    })
  }

  return withTraceContext(context, async () => {
    try {
      const result = await fn(lifecycle.spanId)
      const responseRawValue = result === undefined ? 'null' : JSON.stringify(result, null, 2)
      await recordArtifact({
        spanId: lifecycle.spanId,
        artifactType: 'response_body',
        name: 'outgoing_response_body',
        contentType: 'application/json',
        encoding: 'json',
        direction: 'outbound',
        rawValue: responseRawValue,
        explanation: 'HTTP response body returned by auth-api.'
      })
      await completeSpan({ spanId: lifecycle.spanId, status: 'success' })
      await completeTrace(trace.traceId, 'success')
      return result
    } catch (error) {
      await recordArtifact({
        spanId: lifecycle.spanId,
        artifactType: 'error',
        name: 'request_error',
        contentType: 'text/plain',
        encoding: 'raw',
        direction: 'outbound',
        rawValue: error instanceof Error ? error.stack ?? error.message : String(error),
        explanation: 'Error surfaced while handling the HTTP request.'
      })
      await completeSpan({ spanId: lifecycle.spanId, status: 'error' })
      await completeTrace(trace.traceId, 'error', error instanceof Error ? error.message : String(error))
      throw error
    }
  })
}

export async function queryOne<T extends QueryResultRow>(sql: string, params: unknown[], client?: PoolClient) {
  const executor = client ?? pool
  const result = await executor.query<T>(sql, params)
  return result.rows[0] ?? null
}

process.on('unhandledRejection', (error) => {
  logger.error({ error }, 'Unhandled rejection in observability pipeline')
})

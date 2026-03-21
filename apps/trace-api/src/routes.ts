import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { ClientEventInput } from '@auth-sandbox-2/shared-types'

import {
  appConfig,
  completeSpan,
  completeTrace,
  ensureTrace,
  getArtifactDetail,
  getSpanDetail,
  getTraceDetail,
  ingestClientEvent,
  listTraces,
  recordArtifact,
  startSpan
} from '@auth-sandbox-2/backend-core'

function requireBearerToken(app: any, request: FastifyRequest) {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    throw app.httpErrors.unauthorized('Missing bearer token')
  }
  return authorization.slice('Bearer '.length)
}

function requireExactToken(app: any, request: FastifyRequest, expectedToken: string, label: string) {
  const token = requireBearerToken(app, request)
  if (token !== expectedToken) {
    throw app.httpErrors.forbidden(`Invalid ${label} token`)
  }
}

const observabilityTraceListSchema = z.object({
  status: z.string().optional(),
  traceType: z.string().optional(),
  userId: z.string().optional(),
  deviceId: z.string().optional(),
  actorName: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
})

const clientEventSchema = z.object({
  traceId: z.string().min(1),
  traceType: z.string().optional(),
  parentSpanId: z.string().uuid().nullable().optional(),
  actorName: z.string().min(1),
  operation: z.string().min(1),
  status: z.enum(['running', 'success', 'error']).optional(),
  timestamp: z.string().optional(),
  userId: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  artifacts: z.array(z.object({
    artifactType: z.string().min(1),
    name: z.string().min(1),
    contentType: z.string().nullable().optional(),
    encoding: z.string().nullable().optional(),
    direction: z.string().nullable().optional(),
    rawValue: z.string(),
    explanation: z.string().nullable().optional()
  })).optional()
})

const traceStatusSchema = z.enum(['running', 'success', 'error'])
const spanKindSchema = z.enum(['client_event', 'http_in', 'http_out', 'crypto', 'process'])
const actorTypeSchema = z.enum(['client', 'backend', 'proxy', 'keycloak'])

const ensureTraceSchema = z.object({
  traceId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  traceType: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().nullable().optional(),
  rootClient: z.string().nullable().optional(),
  rootEntrypoint: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional()
})

const startSpanSchema = z.object({
  traceId: z.string().min(1).optional(),
  parentSpanId: z.string().min(1).nullable().optional(),
  kind: spanKindSchema,
  actorType: actorTypeSchema,
  actorName: z.string().min(1),
  operation: z.string().min(1),
  method: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  route: z.string().nullable().optional(),
  targetName: z.string().nullable().optional(),
  status: traceStatusSchema.optional(),
  statusCode: z.number().int().nullable().optional(),
  startedAt: z.coerce.date().optional(),
  userId: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  challengeId: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
})

const completeSpanSchema = z.object({
  spanId: z.string().uuid(),
  status: traceStatusSchema,
  statusCode: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional()
})

const completeTraceSchema = z.object({
  traceId: z.string().min(1),
  status: traceStatusSchema,
  summary: z.string().nullable().optional()
})

const recordArtifactSchema = z.object({
  spanId: z.string().uuid(),
  artifactType: z.string().min(1),
  name: z.string().min(1),
  contentType: z.string().nullable().optional(),
  encoding: z.string().nullable().optional(),
  direction: z.string().nullable().optional(),
  rawValue: z.string(),
  explanation: z.string().nullable().optional()
})

export async function registerTraceRoutes(app: any) {
  app.get('/health', async () => ({ status: 'ok', service: 'trace-api' }))

  app.post('/internal/observability/traces/ensure', async (request: FastifyRequest) => {
    requireExactToken(app, request, appConfig.traceInternalWriteToken, 'trace internal write')
    const body = ensureTraceSchema.parse(request.body)
    return ensureTrace(body)
  })

  app.post('/internal/observability/spans/start', async (request: FastifyRequest) => {
    requireExactToken(app, request, appConfig.traceInternalWriteToken, 'trace internal write')
    const body = startSpanSchema.parse(request.body)
    const result = await startSpan(body)
    return {
      ...result,
      startedAt: result.startedAt.toISOString()
    }
  })

  app.post('/internal/observability/spans/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    requireExactToken(app, request, appConfig.traceInternalWriteToken, 'trace internal write')
    const body = completeSpanSchema.parse(request.body)
    await completeSpan(body)
    reply.code(204)
  })

  app.post('/internal/observability/traces/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    requireExactToken(app, request, appConfig.traceInternalWriteToken, 'trace internal write')
    const body = completeTraceSchema.parse(request.body)
    await completeTrace(body.traceId, body.status, body.summary ?? null)
    reply.code(204)
  })

  app.post('/internal/observability/artifacts/record', async (request: FastifyRequest) => {
    requireExactToken(app, request, appConfig.traceInternalWriteToken, 'trace internal write')
    const body = recordArtifactSchema.parse(request.body)
    const artifactId = await recordArtifact(body)
    return { artifactId }
  })

  app.get('/traces', async (request: FastifyRequest) => {
    requireExactToken(app, request, appConfig.traceBrowserProxyToken, 'trace browser proxy')
    const query = observabilityTraceListSchema.parse(request.query)
    return listTraces(query)
  })

  app.get('/traces/:traceId', async (request: FastifyRequest, reply: FastifyReply) => {
    requireExactToken(app, request, appConfig.traceBrowserProxyToken, 'trace browser proxy')
    const { traceId } = z.object({ traceId: z.string().uuid() }).parse(request.params)
    const result = await getTraceDetail(traceId)
    if (!result) {
      reply.code(404)
      return { message: 'Trace not found' }
    }
    return result
  })

  app.get('/spans/:spanId', async (request: FastifyRequest, reply: FastifyReply) => {
    requireExactToken(app, request, appConfig.traceBrowserProxyToken, 'trace browser proxy')
    const { spanId } = z.object({ spanId: z.string().uuid() }).parse(request.params)
    const result = await getSpanDetail(spanId)
    if (!result) {
      reply.code(404)
      return { message: 'Span not found' }
    }
    return result
  })

  app.get('/artifacts/:artifactId', async (request: FastifyRequest, reply: FastifyReply) => {
    requireExactToken(app, request, appConfig.traceBrowserProxyToken, 'trace browser proxy')
    const { artifactId } = z.object({ artifactId: z.string().uuid() }).parse(request.params)
    const result = await getArtifactDetail(artifactId)
    if (!result) {
      reply.code(404)
      return { message: 'Artifact not found' }
    }
    return result
  })

  app.post('/client-events', async (request: FastifyRequest, reply: FastifyReply) => {
    requireExactToken(app, request, appConfig.traceBrowserProxyToken, 'trace browser proxy')
    const body = clientEventSchema.parse(request.body) as ClientEventInput
    const result = await ingestClientEvent(body)
    reply.code(201)
    return result
  })
}

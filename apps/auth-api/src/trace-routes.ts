import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { ClientEventInput } from '@auth-sandbox-2/shared-types'

import {
  getArtifactDetail,
  getSpanDetail,
  getTraceDetail,
  ingestClientEvent,
  listTraces
} from './observability.js'

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

export async function registerTraceRoutes(app: any) {
  app.get('/health', async () => ({ status: 'ok', service: 'trace-api' }))

  app.get('/traces', async (request: FastifyRequest) => {
    const query = observabilityTraceListSchema.parse(request.query)
    return listTraces(query)
  })

  app.get('/traces/:traceId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { traceId } = z.object({ traceId: z.string().uuid() }).parse(request.params)
    const result = await getTraceDetail(traceId)
    if (!result) {
      reply.code(404)
      return { message: 'Trace not found' }
    }
    return result
  })

  app.get('/spans/:spanId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { spanId } = z.object({ spanId: z.string().uuid() }).parse(request.params)
    const result = await getSpanDetail(spanId)
    if (!result) {
      reply.code(404)
      return { message: 'Span not found' }
    }
    return result
  })

  app.get('/artifacts/:artifactId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { artifactId } = z.object({ artifactId: z.string().uuid() }).parse(request.params)
    const result = await getArtifactDetail(artifactId)
    if (!result) {
      reply.code(404)
      return { message: 'Artifact not found' }
    }
    return result
  })

  app.post('/client-events', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = clientEventSchema.parse(request.body) as ClientEventInput
    const result = await ingestClientEvent(body)
    reply.code(201)
    return result
  })
}

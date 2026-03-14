import { randomUUID } from 'node:crypto'

import type { FastifyReply, FastifyRequest } from 'fastify'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { z } from 'zod'

import {
  getTraceContext,
  withRequestTrace
} from '@auth-sandbox-2/backend-core'
import type {
  MockApiCreateMessageInput,
  MockApiCreateMessageResponse,
  MockApiMessageRecord,
  MockApiMessagesResponse,
  MockApiProfileResponse
} from '@auth-sandbox-2/shared-types'

import { mockApiConfig } from './config.js'

type MockAccessTokenClaims = JWTPayload & {
  azp?: string
  preferred_username?: string
  userId?: string
  scope?: string
}

const jwks = createRemoteJWKSet(new URL(mockApiConfig.jwksUrl))
const createMessageSchema = z.object({
  text: z.string().trim().min(1).max(280)
})

const messagesByUser = new Map<string, MockApiMessageRecord[]>()

function readTraceHeaders(request: FastifyRequest) {
  return {
    traceId: typeof request.headers['x-trace-id'] === 'string' ? request.headers['x-trace-id'] : undefined,
    correlationId: typeof request.headers['x-correlation-id'] === 'string' ? request.headers['x-correlation-id'] : undefined,
    parentSpanId: typeof request.headers['x-span-id'] === 'string' ? request.headers['x-span-id'] : undefined,
    sessionId: typeof request.headers['x-session-id'] === 'string' ? request.headers['x-session-id'] : undefined
  }
}

function setTraceHeaders(reply: FastifyReply, traceHeaders: ReturnType<typeof readTraceHeaders>) {
  if (traceHeaders.traceId) {
    reply.header('x-trace-id', traceHeaders.traceId)
  }
  if (traceHeaders.correlationId) {
    reply.header('x-correlation-id', traceHeaders.correlationId)
  }
}

async function tracedRoute<T>(args: {
  request: FastifyRequest
  reply: FastifyReply
  traceType: string
  title: string
  summary: string
  userId?: string | null
  body?: unknown
  run: () => Promise<T>
}) {
  const traceHeaders = readTraceHeaders(args.request)
  setTraceHeaders(args.reply, traceHeaders)

  const traceId = traceHeaders.traceId ?? traceHeaders.correlationId ?? randomUUID()
  const correlationId = traceHeaders.correlationId ?? traceId
  args.reply.header('x-trace-id', traceId)
  args.reply.header('x-correlation-id', correlationId)

  return withRequestTrace(
    {
      traceType: args.traceType,
      title: args.title,
      summary: args.summary,
      rootClient: typeof args.request.headers['x-client-name'] === 'string' ? args.request.headers['x-client-name'] : 'unknown-client',
      rootEntrypoint: `${args.request.method} ${args.request.routeOptions.url}`,
      correlationId,
      traceId,
      sessionId: traceHeaders.sessionId ?? null,
      userId: args.userId ?? null,
      parentSpanId: traceHeaders.parentSpanId ?? null,
      method: args.request.method,
      url: args.request.url,
      route: args.request.routeOptions.url,
      body: args.body,
      headers: Object.fromEntries(Object.entries(args.request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)]))
    },
    args.run
  )
}

async function verifyAccessToken(request: FastifyRequest) {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Missing bearer token')
  }

  const token = authorization.slice('Bearer '.length)
  const { payload } = await jwtVerify(token, jwks, {
    issuer: mockApiConfig.issuer,
    audience: mockApiConfig.audience
  })

  return payload as MockAccessTokenClaims
}

function getUserId(claims: MockAccessTokenClaims) {
  return claims.preferred_username ?? claims.userId ?? claims.sub ?? 'unknown-user'
}

function normalizeAudience(claims: MockAccessTokenClaims) {
  const { aud } = claims
  if (Array.isArray(aud)) {
    return aud
  }
  if (typeof aud === 'string') {
    return [aud]
  }
  return []
}

function normalizeScope(scope: string | undefined) {
  return scope ? scope.split(' ').filter(Boolean) : []
}

function toIsoDateTime(value: number | undefined) {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : null
}

function readTraceEnvelope() {
  const trace = getTraceContext()
  return {
    traceId: trace?.traceId ?? null,
    correlationId: trace?.correlationId ?? null
  }
}

function getMessages(userId: string) {
  const existing = messagesByUser.get(userId)
  if (existing) {
    return existing
  }

  const seeded: MockApiMessageRecord[] = [
    {
      id: `seed-${userId}`,
      text: `JWKS and audience validation accepted the current token for ${userId}.`,
      authorUserId: userId,
      createdAt: new Date().toISOString(),
      category: 'seed'
    }
  ]
  messagesByUser.set(userId, seeded)
  return seeded
}

function createMessage(userId: string, input: MockApiCreateMessageInput) {
  const messages = getMessages(userId)
  const item: MockApiMessageRecord = {
    id: randomUUID(),
    text: input.text,
    authorUserId: userId,
    createdAt: new Date().toISOString(),
    category: 'note'
  }

  messages.unshift(item)
  return item
}

export async function registerMockRoutes(app: any) {
  app.get('/health', async () => ({ status: 'ok', service: 'mock-api' }))

  app.get('/api/mock/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    let claims: MockAccessTokenClaims
    try {
      claims = await verifyAccessToken(request)
    } catch {
      reply.code(401)
      return { message: 'OIDC token missing, invalid, or audience does not match mock-api' }
    }

    const userId = getUserId(claims)
    return tracedRoute({
      request,
      reply,
      traceType: 'mock_api_profile_read',
      title: `Mock profile for ${userId}`,
      summary: 'mock-api accepted the Keycloak access token after JWKS signature and audience validation.',
      userId,
      run: async (): Promise<MockApiProfileResponse> => ({
        ...readTraceEnvelope(),
        subject: claims.sub ?? userId,
        userId,
        username: claims.preferred_username ?? userId,
        audience: normalizeAudience(claims),
        scope: normalizeScope(claims.scope),
        issuer: typeof claims.iss === 'string' ? claims.iss : mockApiConfig.issuer,
        clientId: claims.azp ?? null,
        issuedAt: toIsoDateTime(claims.iat),
        expiresAt: toIsoDateTime(claims.exp)
      })
    })
  })

  app.get('/api/mock/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    let claims: MockAccessTokenClaims
    try {
      claims = await verifyAccessToken(request)
    } catch {
      reply.code(401)
      return { message: 'OIDC token missing, invalid, or audience does not match mock-api' }
    }

    const userId = getUserId(claims)
    return tracedRoute({
      request,
      reply,
      traceType: 'mock_api_messages_list',
      title: `Mock messages for ${userId}`,
      summary: 'app-web loaded protected mock-api data with the current access token.',
      userId,
      run: async (): Promise<MockApiMessagesResponse> => ({
        ...readTraceEnvelope(),
        items: getMessages(userId)
      })
    })
  })

  app.post('/api/mock/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    let claims: MockAccessTokenClaims
    try {
      claims = await verifyAccessToken(request)
    } catch {
      reply.code(401)
      return { message: 'OIDC token missing, invalid, or audience does not match mock-api' }
    }

    const body = createMessageSchema.parse(request.body)
    const userId = getUserId(claims)
    const result = await tracedRoute({
      request,
      reply,
      traceType: 'mock_api_message_create',
      title: `Create mock message for ${userId}`,
      summary: 'app-web posted a protected mock-api request using the current Keycloak access token.',
      userId,
      body,
      run: async (): Promise<MockApiCreateMessageResponse> => ({
        ...readTraceEnvelope(),
        item: createMessage(userId, body)
      })
    })
    reply.code(201)
    return result
  })
}

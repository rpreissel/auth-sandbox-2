import { randomUUID } from 'node:crypto'

import type { FastifyReply, FastifyRequest } from 'fastify'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'

import {
  keycloakConfig,
  withRequestTrace
} from '@auth-sandbox-2/backend-core'
import {
  createPublicAssuranceFlow,
  finalizePublicAssuranceFlow,
  getPublicAssuranceFlow,
  redeemFlowArtifact
} from './assurance-flows.js'
import { verifyFlowToken, verifyServiceToken } from './flow-tokens.js'
import { isAllowedInternalRedeemTokenClaims, type InternalRedeemAccessTokenClaims } from './internal-auth.js'
import {
  completeKeycloakBrowserStepUp,
  completeFlowService,
  createRegistrationIdentity,
  deleteDevice,
  finishLogin,
  listRegistrationIdentities,
  listDevices,
  logout,
  refreshTokens,
  resendFlowService,
  completeMobileStepUp,
  selectFlowService,
  startKeycloakBrowserStepUp,
  startFlowService,
  setPassword,
  startBrowserStepUpFlow,
  startLogin
} from './services.js'

const createFlowSchema = z.object({
  purpose: z.enum(['registration', 'account_upgrade', 'step_up']),
  requiredAcr: z.enum(['level_1', 'level_2']).optional(),
  deviceId: z.string().uuid().optional(),
  subjectId: z.string().min(1).optional(),
  context: z.record(z.string(), z.json()).optional()
})

const getFlowParamsSchema = z.object({
  flowId: z.string().min(1)
})

const selectFlowServiceSchema = z.object({
  service: z.enum(['person_code', 'sms_tan'])
})
const personCodeCompleteSchema = z.object({ code: z.string().min(1) })
const smsTanCompleteSchema = z.object({ tan: z.string().min(1) })

const finalizeFlowSchema = z.object({
  serviceResultToken: z.string().min(1).optional(),
  channel: z.enum(['registration', 'mobile', 'browser', 'keycloak']).optional()
})

const redeemArtifactSchema = z.object({
  code: z.string().min(1),
  kind: z.enum(['assurance_handle', 'result_code'])
})

const createRegistrationIdentitySchema = z.object({
  userId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthDate: z.string().min(1),
  code: z.string().min(1).optional(),
  codeValidForDays: z.number().int().positive().optional(),
  phoneNumber: z.string().min(1).optional()
})

const setPasswordSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(8)
})

const startLoginSchema = z.object({
  publicKeyHash: z.string().min(1)
})

const finishLoginSchema = z.object({
  nonce: z.string().min(1),
  encryptedKey: z.string().min(1),
  encryptedData: z.string().min(1),
  iv: z.string().min(1),
  signature: z.string().min(1)
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
})

const browserStepUpSchema = z.object({
  userId: z.string().min(1),
  phoneNumber: z.string().min(1),
  requiredAcr: z.enum(['level_1', 'level_2']).optional()
})

const mobileStepUpSchema = z.object({
  userId: z.string().min(1),
  phoneNumber: z.string().min(1),
  refreshToken: z.string().min(1).optional()
})

const internalBrowserStepUpStartSchema = z.object({
  userId: z.string().min(1)
})

const internalBrowserStepUpCompleteSchema = z.object({
  flowId: z.string().min(1),
  serviceToken: z.string().min(1),
  tan: z.string().min(1)
})

const keycloakJwks = createRemoteJWKSet(new URL(`${keycloakConfig.baseUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/certs`))

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

function requireBearerToken(app: any, request: FastifyRequest) {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    throw app.httpErrors.unauthorized('Missing bearer token')
  }
  return authorization.slice('Bearer '.length)
}

function requireFlowToken(app: any, request: FastifyRequest, flowId: string) {
  const token = requireBearerToken(app, request)
  const result = verifyFlowToken(token, flowId)
  if (!result.ok) {
    if (result.reason === 'expired') {
      throw app.httpErrors.unauthorized('Flow token expired')
    }
    throw app.httpErrors.forbidden('Invalid flow token')
  }
}

function requireServiceToken(app: any, request: FastifyRequest, service: 'person_code' | 'sms_tan') {
  const token = requireBearerToken(app, request)
  const result = verifyServiceToken(token, service)
  if (!result.ok) {
    if (result.reason === 'expired') {
      throw app.httpErrors.unauthorized('Service token expired')
    }
    throw app.httpErrors.forbidden('Invalid service token')
  }
  return result.claims
}

async function requireInternalRedeemAccessToken(app: any, request: FastifyRequest) {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    throw app.httpErrors.unauthorized('Missing bearer token')
  }

  const token = authorization.slice('Bearer '.length)
  let payload: InternalRedeemAccessTokenClaims

  try {
    const verified = await jwtVerify(token, keycloakJwks, {
      issuer: `${keycloakConfig.publicUrl}/realms/${keycloakConfig.realm}`
    })
    payload = verified.payload as InternalRedeemAccessTokenClaims
  } catch {
    throw app.httpErrors.unauthorized('Invalid bearer token')
  }

  if (!isAllowedInternalRedeemTokenClaims(payload, keycloakConfig.internalRedeemClientId)) {
    throw app.httpErrors.forbidden('Bearer token is not allowed to redeem flow artifacts')
  }
}

async function tracedRoute<T>(args: {
  request: FastifyRequest
  reply: FastifyReply
  traceType: string
  title: string
  summary: string
  userId?: string | null
  deviceId?: string | null
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
      deviceId: args.deviceId ?? null,
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

export async function registerRoutes(app: any) {
  app.get('/api/health', async () => ({ status: 'ok', service: 'auth-api' }))

  app.post('/api/flows', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createFlowSchema.parse(request.body)
    const result = await tracedRoute({
      request,
      reply,
      traceType: 'generic_flow_create',
      title: `Create ${body.purpose} flow`,
      summary: 'A client created a new generic assurance flow.',
      userId: body.subjectId ?? null,
      deviceId: body.deviceId ?? null,
      body,
      run: () => createPublicAssuranceFlow(body)
    })
    reply.code(201)
    return result
  })

  app.get('/api/flows/:flowId', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = getFlowParamsSchema.parse(request.params)
    requireFlowToken(app, request, params.flowId)
    const result = await tracedRoute({
      request,
      reply,
      traceType: 'generic_flow_get',
      title: `Get flow ${params.flowId}`,
      summary: 'A client fetched the current state of a generic assurance flow.',
      run: () => getPublicAssuranceFlow(params.flowId)
    })

    if (!result) {
      throw app.httpErrors.notFound('Unknown flow')
    }

    return result
  })

  app.post('/api/flows/:flowId/select-service', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = getFlowParamsSchema.parse(request.params)
    const body = selectFlowServiceSchema.parse(request.body)
    requireFlowToken(app, request, params.flowId)
    return tracedRoute({
      request,
      reply,
      traceType: 'flow_select_service',
      title: `Select ${body.service} for ${params.flowId}`,
      summary: 'A client selected a concrete identification service for a flow.',
      body,
      run: () => selectFlowService(params.flowId, body.service)
    })
  })

  app.post('/api/identification/person-code/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const claims = requireServiceToken(app, request, 'person_code')
    const body = personCodeCompleteSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'person_code_complete',
      title: `Complete person_code for ${claims.flowId}`,
      summary: 'A client completed the fixed person-code identification service.',
      body,
      run: () => completeFlowService(claims.flowId, 'person_code', { code: body.code })
    })
  })

  app.post('/api/identification/sms-tan/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const claims = requireServiceToken(app, request, 'sms_tan')
    return tracedRoute({
      request,
      reply,
      traceType: 'sms_tan_start',
      title: `Start sms_tan for ${claims.flowId}`,
      summary: 'A client started the fixed SMS-TAN identification service.',
      run: () => startFlowService(claims.flowId, 'sms_tan')
    })
  })

  app.post('/api/identification/sms-tan/resend', async (request: FastifyRequest, reply: FastifyReply) => {
    const claims = requireServiceToken(app, request, 'sms_tan')
    return tracedRoute({
      request,
      reply,
      traceType: 'sms_tan_resend',
      title: `Resend sms_tan for ${claims.flowId}`,
      summary: 'A client requested a fresh SMS-TAN challenge.',
      run: () => resendFlowService(claims.flowId, 'sms_tan')
    })
  })

  app.post('/api/identification/sms-tan/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const claims = requireServiceToken(app, request, 'sms_tan')
    const body = smsTanCompleteSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'sms_tan_complete',
      title: `Complete sms_tan for ${claims.flowId}`,
      summary: 'A client completed the fixed SMS-TAN identification service.',
      body,
      run: () => completeFlowService(claims.flowId, 'sms_tan', { tan: body.tan })
    })
  })

  app.post('/api/flows/:flowId/finalize', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = getFlowParamsSchema.parse(request.params)
    const body = finalizeFlowSchema.parse(request.body ?? {})
    requireFlowToken(app, request, params.flowId)
    return tracedRoute({
      request,
      reply,
      traceType: 'generic_flow_finalize',
      title: `Finalize flow ${params.flowId}`,
      summary: 'A client finalized a generic assurance flow.',
      body,
      run: () => finalizePublicAssuranceFlow(params.flowId, body)
    })
  })

  app.post('/api/internal/flows/redeem', async (request: FastifyRequest, reply: FastifyReply) => {
    await requireInternalRedeemAccessToken(app, request)
    const body = redeemArtifactSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'generic_flow_artifact_redeem',
      title: `Redeem ${body.kind}`,
      summary: 'A trusted backend redeemed a generic assurance-flow artifact.',
      body,
      run: () => redeemFlowArtifact(body.code, body.kind)
    })
  })

  app.post('/api/internal/browser-step-up/start', async (request: FastifyRequest, reply: FastifyReply) => {
    await requireInternalRedeemAccessToken(app, request)
    const body = internalBrowserStepUpStartSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'browser_step_up_start_internal',
      title: `Start browser step-up for ${body.userId}`,
      summary: 'Keycloak started an inline browser SMS-TAN step-up flow through auth-api.',
      userId: body.userId,
      body,
      run: () => startKeycloakBrowserStepUp(body.userId)
    })
  })

  app.post('/api/internal/browser-step-up/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    await requireInternalRedeemAccessToken(app, request)
    const body = internalBrowserStepUpCompleteSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'browser_step_up_complete_internal',
      title: `Complete browser step-up for ${body.flowId}`,
      summary: 'Keycloak completed an inline browser SMS-TAN step-up flow through auth-api.',
      body,
      run: () => completeKeycloakBrowserStepUp(body)
    })
  })

  app.post('/api/admin/registration-identities', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createRegistrationIdentitySchema.parse(request.body)
    const result = await tracedRoute({
      request,
      reply,
      traceType: 'admin_registration_identity_create',
      title: `Create registration identity for ${body.userId}`,
      summary: 'Admin web created the person, code, and SMS registration records for a reusable registration identity.',
      userId: body.userId,
      body,
      run: () => createRegistrationIdentity(body)
    })
    reply.code(201)
    return result
  })
  app.get('/api/admin/registration-identities', async (request: FastifyRequest, reply: FastifyReply) => tracedRoute({
    request,
    reply,
    traceType: 'admin_registration_identities_list',
    title: 'Admin registration identities list',
    summary: 'Admin web requested the current registration identities inventory.',
    run: () => listRegistrationIdentities()
  }))
  app.get('/api/admin/devices', async (request: FastifyRequest, reply: FastifyReply) => tracedRoute({
    request,
    reply,
    traceType: 'admin_devices_list',
    title: 'Admin device list',
    summary: 'Admin web requested the current device inventory.',
    run: () => listDevices()
  }))
  app.delete('/api/admin/devices/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    await tracedRoute({
      request,
      reply,
      traceType: 'admin_device_delete',
      title: `Delete device ${params.id}`,
      summary: 'Admin web removed a registered device from the demo environment.',
      run: () => deleteDevice(params.id)
    })
    reply.code(204)
  })

  app.post('/api/device/set-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = setPasswordSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'device_set_password',
      title: `Set password for ${body.userId}`,
      summary: 'App web asked auth-api to set the initial Keycloak password for the demo user.',
      userId: body.userId,
      body,
      run: () => setPassword(body)
    })
  })
  app.post('/api/device/login/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = startLoginSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'device_login_start',
      title: `Start device login for ${body.publicKeyHash}`,
      summary: 'App web requested an encrypted challenge for the saved device binding.',
      body,
      run: () => startLogin(body)
    })
  })
  app.post('/api/device/login/finish', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = finishLoginSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'device_login_finish',
      title: `Finish device login ${body.nonce}`,
      summary: 'App web returned the signed challenge response and auth-api exchanged it with Keycloak.',
      body,
      run: () => finishLogin(body)
    })
  })
  app.post('/api/device/token/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = refreshSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'device_token_refresh',
      title: 'Refresh device tokens',
      summary: 'App web refreshed the Keycloak token bundle for the device session.',
      body,
      run: () => refreshTokens(body)
    })
  })
  app.post('/api/device/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = refreshSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'device_logout',
      title: 'Device logout',
      summary: 'App web revoked the refresh token and ended the demo session.',
      body,
      run: () => logout(body)
    })
  })

  app.post('/api/step-up/browser/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = browserStepUpSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'browser_step_up_start',
      title: `Start browser step-up for ${body.userId}`,
      summary: 'A browser-compatible step-up flow was created and finalized for backchannel redeem.',
      userId: body.userId,
      body,
      run: () => startBrowserStepUpFlow(body)
    })
  })

  app.post('/api/step-up/mobile/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = mobileStepUpSchema.parse(request.body)
    return tracedRoute({
      request,
      reply,
      traceType: 'mobile_step_up_complete',
      title: `Complete mobile step-up for ${body.userId}`,
      summary: 'A mobile step-up flow was finalized and redeemed through the custom assurance-handle grant.',
      userId: body.userId,
      body,
      run: () => completeMobileStepUp(body)
    })
  })
}

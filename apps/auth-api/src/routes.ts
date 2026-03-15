import { randomUUID } from 'node:crypto'

import type { FastifyReply, FastifyRequest } from 'fastify'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'

import {
  keycloakConfig,
  withRequestTrace
} from '@auth-sandbox-2/backend-core'
import {
  completePublicAssuranceFlowMethod,
  createPublicAssuranceFlow,
  finalizePublicAssuranceFlow,
  getPublicAssuranceFlow,
  redeemFlowArtifact,
  startPublicAssuranceFlowMethod
} from './assurance-flows.js'
import { verifyFlowToken } from './flow-tokens.js'
import { isAllowedInternalRedeemTokenClaims, type InternalRedeemAccessTokenClaims } from './internal-auth.js'
import {
  createRegistrationCode,
  deleteDevice,
  deleteRegistrationCode,
  finishLogin,
  listDevices,
  listRegistrationCodes,
  logout,
  refreshTokens,
  registerDevice,
  completeMobileStepUp,
  setPassword,
  startBrowserStepUpFlow,
  startLogin
} from './services.js'

const createFlowSchema = z.object({
  purpose: z.enum(['registration', 'account_upgrade', 'step_up']),
  requestedAcr: z.string().min(1).optional(),
  targetAssurance: z.string().min(1).optional(),
  deviceId: z.string().uuid().optional(),
  userHint: z.string().min(1).optional(),
  prospectiveUserId: z.string().min(1).optional(),
  context: z.record(z.string(), z.json()).optional()
})

const getFlowParamsSchema = z.object({
  flowId: z.string().min(1)
})

const flowMethodParamsSchema = z.object({
  flowId: z.string().min(1),
  method: z.enum(['code', 'sms'])
})

const startFlowMethodSchema = z.object({
  payload: z.record(z.string(), z.json()).optional()
})

const completeFlowMethodSchema = z.object({
  payload: z.record(z.string(), z.json()).optional()
})

const finalizeFlowSchema = z.object({
  channel: z.enum(['registration', 'mobile', 'browser']).optional()
})

const redeemArtifactSchema = z.object({
  code: z.string().min(1),
  kind: z.enum(['assurance_handle', 'result_code'])
})

const createRegistrationCodeSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().optional(),
  validForDays: z.number().int().positive().optional()
})

const registerDeviceSchema = z.object({
  userId: z.string().min(1),
  deviceName: z.string().min(1),
  activationCode: z.string().min(1),
  publicKey: z.string().min(1)
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
  requestedAcr: z.string().min(1).optional()
})

const mobileStepUpSchema = z.object({
  userId: z.string().min(1),
  phoneNumber: z.string().min(1),
  refreshToken: z.string().min(1).optional()
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

function requireFlowToken(app: any, request: FastifyRequest, flowId: string) {
  const token = request.headers['x-flow-token']
  if (typeof token !== 'string' || token.length === 0) {
    throw app.httpErrors.unauthorized('Missing flow token')
  }

  const result = verifyFlowToken(token, flowId)
  if (!result.ok) {
    if (result.reason === 'expired') {
      throw app.httpErrors.unauthorized('Flow token expired')
    }
    throw app.httpErrors.forbidden('Invalid flow token')
  }
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
      userId: body.prospectiveUserId ?? body.userHint ?? null,
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

  app.post('/api/flows/:flowId/methods/:method/start', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = flowMethodParamsSchema.parse(request.params)
    const body = startFlowMethodSchema.parse(request.body ?? {})
    requireFlowToken(app, request, params.flowId)
    return tracedRoute({
      request,
      reply,
      traceType: 'generic_flow_method_start',
      title: `Start ${params.method} for ${params.flowId}`,
      summary: 'A client started a generic assurance-flow method.',
      body,
      run: () => startPublicAssuranceFlowMethod(params.flowId, params.method, body)
    })
  })

  app.post('/api/flows/:flowId/methods/:method/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = flowMethodParamsSchema.parse(request.params)
    const body = completeFlowMethodSchema.parse(request.body ?? {})
    requireFlowToken(app, request, params.flowId)
    return tracedRoute({
      request,
      reply,
      traceType: 'generic_flow_method_complete',
      title: `Complete ${params.method} for ${params.flowId}`,
      summary: 'A client completed a generic assurance-flow method.',
      body,
      run: () => completePublicAssuranceFlowMethod(params.flowId, params.method, body)
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
      run: () => finalizePublicAssuranceFlow(params.flowId, body.channel ?? 'registration')
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

  app.get('/api/admin/registration-codes', async (request: FastifyRequest, reply: FastifyReply) => tracedRoute({
    request,
    reply,
    traceType: 'admin_registration_codes_list',
    title: 'Admin registration codes list',
    summary: 'Admin web requested the current registration code list.',
    run: () => listRegistrationCodes()
  }))
  app.post('/api/admin/registration-codes', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createRegistrationCodeSchema.parse(request.body)
    const result = await tracedRoute({
      request,
      reply,
      traceType: 'admin_registration_code_create',
      title: `Create registration code for ${body.userId}`,
      summary: 'Admin web created a new activation code for a demo device registration.',
      userId: body.userId,
      body,
      run: () => createRegistrationCode(body)
    })
    reply.code(201)
    return result
  })
  app.delete('/api/admin/registration-codes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    await tracedRoute({
      request,
      reply,
      traceType: 'admin_registration_code_delete',
      title: `Delete registration code ${params.id}`,
      summary: 'Admin web removed an activation code from the demo environment.',
      run: () => deleteRegistrationCode(params.id)
    })
    reply.code(204)
  })

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

  app.post('/api/device/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerDeviceSchema.parse(request.body)
    reply.header('x-auth-sandbox-deprecated', 'Use POST /api/flows with purpose=registration plus method/finalize endpoints')
    const result = await tracedRoute({
      request,
      reply,
      traceType: 'device_register',
      title: `Register device ${body.deviceName}`,
      summary: 'App web registered a device and created the corresponding Keycloak credential.',
      userId: body.userId,
      body,
      run: () => registerDevice(body)
    })
    reply.code(201)
    return result
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

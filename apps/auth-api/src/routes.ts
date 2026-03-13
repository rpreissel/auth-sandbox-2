import { randomUUID } from 'node:crypto'

import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import {
  withRequestTrace
} from './observability.js'
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
  setPassword,
  startLogin
} from './services.js'

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
}

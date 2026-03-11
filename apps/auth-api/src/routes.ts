import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

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

export async function registerRoutes(app: any) {
  app.get('/api/health', async () => ({ status: 'ok', service: 'auth-api' }))

  app.get('/api/admin/registration-codes', async () => listRegistrationCodes())
  app.post('/api/admin/registration-codes', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createRegistrationCodeSchema.parse(request.body)
    const result = await createRegistrationCode(body)
    reply.code(201)
    return result
  })
  app.delete('/api/admin/registration-codes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    await deleteRegistrationCode(params.id)
    reply.code(204)
  })

  app.get('/api/admin/devices', async () => listDevices())
  app.delete('/api/admin/devices/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params)
    await deleteDevice(params.id)
    reply.code(204)
  })

  app.post('/api/device/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerDeviceSchema.parse(request.body)
    const result = await registerDevice(body)
    reply.code(201)
    return result
  })

  app.post('/api/device/set-password', async (request: FastifyRequest) => setPassword(setPasswordSchema.parse(request.body)))
  app.post('/api/device/login/start', async (request: FastifyRequest) => startLogin(startLoginSchema.parse(request.body)))
  app.post('/api/device/login/finish', async (request: FastifyRequest) => finishLogin(finishLoginSchema.parse(request.body)))
  app.post('/api/device/token/refresh', async (request: FastifyRequest) => refreshTokens(refreshSchema.parse(request.body)))
  app.post('/api/device/logout', async (request: FastifyRequest) => logout(refreshSchema.parse(request.body)))
}

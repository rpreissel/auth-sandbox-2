import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'

import { appConfig, logger, runMigrations } from '@auth-sandbox-2/backend-core'
import { registerRoutes } from './routes.js'

const app = Fastify({
  loggerInstance: logger
})

await app.register(sensible)
await app.register(cors, {
  origin: appConfig.corsOrigins,
  credentials: true
})
await registerRoutes(app)
await runMigrations(['apps/auth-api/migrations', 'packages/backend-core/migrations'])

app.get('/blank', async (_request, reply) => {
  reply.type('text/html').send('<!doctype html><title>blank</title>blank')
})

const shutdown = async () => {
  await app.close()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await app.listen({
  host: appConfig.host,
  port: appConfig.port
})

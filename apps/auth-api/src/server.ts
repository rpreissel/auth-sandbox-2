import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'

import { appConfig } from './config.js'
import { runMigrations } from './migrate.js'
import { registerRoutes } from './routes.js'
import { startTelemetry, stopTelemetry } from './telemetry.js'
import { logger } from './logger.js'

const app = Fastify({
  loggerInstance: logger
})

await startTelemetry()
await app.register(sensible)
await app.register(cors, {
  origin: appConfig.corsOrigins,
  credentials: true
})
await registerRoutes(app)
await runMigrations()

app.get('/blank', async (_request, reply) => {
  reply.type('text/html').send('<!doctype html><title>blank</title>blank')
})

const shutdown = async () => {
  await app.close()
  await stopTelemetry()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await app.listen({
  host: appConfig.host,
  port: appConfig.port
})

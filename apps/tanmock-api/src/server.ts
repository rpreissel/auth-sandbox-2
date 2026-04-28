import Fastify from 'fastify'
import cors from '@fastify/cors'
import formbody from '@fastify/formbody'
import sensible from '@fastify/sensible'

process.env.OBSERVABILITY_SERVICE_NAME ??= 'tanmock-api'

import { logger, runMigrations } from '@auth-sandbox-2/backend-core'

import { tanMockApiConfig } from './config.js'
import { registerRoutes } from './routes.js'

const app = Fastify({
  loggerInstance: logger
})

await app.register(sensible)
await app.register(formbody)
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || tanMockApiConfig.corsOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error(`Origin ${origin} is not allowed`), false)
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  allowedHeaders: ['authorization', 'content-type']
})
await registerRoutes(app)
await runMigrations(['apps/tanmock-api/migrations', 'packages/backend-core/migrations'])

const shutdown = async () => {
  await app.close()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await app.listen({
  host: tanMockApiConfig.host,
  port: tanMockApiConfig.port
})

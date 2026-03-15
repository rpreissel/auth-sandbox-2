import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'

process.env.OBSERVABILITY_SERVICE_NAME ??= 'trace-api'

import { appConfig, logger, runMigrations } from '@auth-sandbox-2/backend-core'
import { registerTraceRoutes } from './routes.js'

const host = process.env.TRACE_API_HOST ?? appConfig.host
const port = Number(process.env.TRACE_API_PORT ?? 3001)

const app = Fastify({
  loggerInstance: logger
})

await app.register(sensible)
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || appConfig.corsOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new Error(`Origin ${origin} is not allowed`), false)
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-client-name', 'x-correlation-id', 'x-trace-id', 'x-session-id', 'x-span-id'],
  exposedHeaders: ['x-trace-id', 'x-correlation-id'],
  maxAge: 86400
})
await registerTraceRoutes(app)
await runMigrations()

const shutdown = async () => {
  await app.close()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await app.listen({
  host,
  port
})

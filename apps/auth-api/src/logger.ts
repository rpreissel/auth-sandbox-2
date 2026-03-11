import pino from 'pino'
import { trace } from '@opentelemetry/api'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production'
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard'
        }
      },
  mixin() {
    const span = trace.getActiveSpan()
    const traceContext = span?.spanContext()

    return traceContext
      ? {
          traceId: traceContext.traceId,
          spanId: traceContext.spanId
        }
      : {}
  }
})

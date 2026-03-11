import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

import { otelConfig } from './config.js'

let sdk: NodeSDK | undefined

export async function startTelemetry() {
  if (!otelConfig.enabled) {
    return
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'auth-api'
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()]
  })

  try {
    await sdk.start()
  } catch {
    sdk = undefined
  }
}

export async function stopTelemetry() {
  if (sdk) {
    await sdk.shutdown()
  }
}

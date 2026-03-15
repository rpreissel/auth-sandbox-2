import { createHmac, timingSafeEqual } from 'node:crypto'

import { appConfig } from '@auth-sandbox-2/backend-core'

type FlowTokenClaims = {
  flowId: string
  expiresAt: string
}

type VerifyFlowTokenResult =
  | { ok: true; claims: FlowTokenClaims }
  | { ok: false; reason: 'invalid' | 'expired' }

function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function getFlowTokenSecret() {
  if (typeof (appConfig as { flowTokenSecret?: unknown }).flowTokenSecret === 'string') {
    return (appConfig as { flowTokenSecret: string }).flowTokenSecret
  }
  return process.env.AUTH_API_FLOW_TOKEN_SECRET ?? 'change-me-flow-token-secret'
}

function signPayload(payload: string) {
  return createHmac('sha256', getFlowTokenSecret()).update(payload).digest()
}

export function createFlowToken(flowId: string, expiresAt: string) {
  const claims: FlowTokenClaims = { flowId, expiresAt }
  const payload = encodeBase64Url(JSON.stringify(claims))
  const signature = encodeBase64Url(signPayload(payload))
  return `${payload}.${signature}`
}

export function verifyFlowToken(token: string, expectedFlowId: string): VerifyFlowTokenResult {
  const parts = token.split('.')
  if (parts.length !== 2) {
    return { ok: false, reason: 'invalid' }
  }

  const [payload, signature] = parts

  try {
    const expectedSignature = signPayload(payload)
    const actualSignature = Buffer.from(signature, 'base64url')
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
      return { ok: false, reason: 'invalid' }
    }

    const claims = JSON.parse(decodeBase64Url(payload)) as Partial<FlowTokenClaims>
    if (typeof claims.flowId !== 'string' || typeof claims.expiresAt !== 'string') {
      return { ok: false, reason: 'invalid' }
    }
    if (claims.flowId !== expectedFlowId) {
      return { ok: false, reason: 'invalid' }
    }
    if (Number.isNaN(Date.parse(claims.expiresAt)) || Date.parse(claims.expiresAt) < Date.now()) {
      return { ok: false, reason: 'expired' }
    }

    return {
      ok: true,
      claims: {
        flowId: claims.flowId,
        expiresAt: claims.expiresAt
      }
    }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

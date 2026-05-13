import { createHmac } from 'node:crypto'

import { appConfig } from '@auth-sandbox-2/backend-core'

function getDeviceHandoverDerivationSecret() {
  if (typeof (appConfig as { deviceHandoverDerivationSecret?: unknown }).deviceHandoverDerivationSecret === 'string') {
    return (appConfig as { deviceHandoverDerivationSecret: string }).deviceHandoverDerivationSecret
  }
  return process.env.AUTH_API_DEVICE_HANDOVER_DERIVATION_SECRET ?? 'change-me-device-handover-derivation-secret'
}

function encode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function buildMaterial(parts: string[]) {
  return parts.map((part) => encode(part)).join('.')
}

export function deriveUserDeviceHandoverSecret(userId: string) {
  return createHmac('sha256', getDeviceHandoverDerivationSecret())
    .update(`device-handover:${userId}`, 'utf8')
    .digest('base64url')
}

export function createDeviceHandoverProof(input: {
  userHandoverSecret: string
  userId: string
  publicKeyHash: string
  nonce: string
  exp: number
  jti: string
  acr?: string | null
}) {
  const material = buildMaterial([
    'device',
    input.userId,
    input.publicKeyHash,
    input.nonce,
    String(input.exp),
    input.jti,
    input.acr ?? ''
  ])

  return createHmac('sha256', input.userHandoverSecret)
    .update(material, 'utf8')
    .digest('base64url')
}

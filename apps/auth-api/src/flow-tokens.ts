import { createHmac, timingSafeEqual } from 'node:crypto'

import { appConfig } from '@auth-sandbox-2/backend-core'

type BaseTokenClaims = {
  kind: 'flow' | 'service' | 'service_result' | 'password_setup' | 'device_conflict' | 'mobile_step_up'
  expiresAt: string
}

type FlowTokenClaims = BaseTokenClaims & {
  flowId: string
}

type ServiceTokenClaims = BaseTokenClaims & {
  flowId: string
  service: string
  serviceSessionId: string
}

type ServiceResultTokenClaims = BaseTokenClaims & {
  flowId: string
  service: string
  achievedAcr: string
  serviceSessionId: string
}

type PasswordSetupTokenClaims = BaseTokenClaims & {
  flowId: string
  userId: string
}

type DeviceConflictTokenClaims = BaseTokenClaims & {
  userId: string
  deviceId: string
}

type MobileStepUpTokenClaims = BaseTokenClaims & {
  userId: string
  phoneNumber: string
}

type VerifyFlowTokenResult =
  | { ok: true; claims: FlowTokenClaims }
  | { ok: false; reason: 'invalid' | 'expired' }

type VerifyServiceTokenResult =
  | { ok: true; claims: ServiceTokenClaims }
  | { ok: false; reason: 'invalid' | 'expired' }

type VerifyServiceResultTokenResult =
  | { ok: true; claims: ServiceResultTokenClaims }
  | { ok: false; reason: 'invalid' | 'expired' }

type VerifyPasswordSetupTokenResult =
  | { ok: true; claims: PasswordSetupTokenClaims }
  | { ok: false; reason: 'invalid' | 'expired' }

type VerifyDeviceConflictTokenResult =
  | { ok: true; claims: DeviceConflictTokenClaims }
  | { ok: false; reason: 'invalid' | 'expired' }

type VerifyMobileStepUpTokenResult =
  | { ok: true; claims: MobileStepUpTokenClaims }
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

function createSignedToken<T extends BaseTokenClaims>(claims: T) {
  const payload = encodeBase64Url(JSON.stringify(claims))
  const signature = encodeBase64Url(signPayload(payload))
  return `${payload}.${signature}`
}

export function createFlowToken(flowId: string, expiresAt: string) {
  return createSignedToken<FlowTokenClaims>({ kind: 'flow', flowId, expiresAt })
}

export function createServiceToken(flowId: string, service: string, serviceSessionId: string, expiresAt: string) {
  return createSignedToken<ServiceTokenClaims>({ kind: 'service', flowId, service, serviceSessionId, expiresAt })
}

export function createServiceResultToken(flowId: string, service: string, serviceSessionId: string, achievedAcr: string, expiresAt: string) {
  return createSignedToken<ServiceResultTokenClaims>({ kind: 'service_result', flowId, service, serviceSessionId, achievedAcr, expiresAt })
}

export function createPasswordSetupToken(flowId: string, userId: string, expiresAt: string) {
  return createSignedToken<PasswordSetupTokenClaims>({ kind: 'password_setup', flowId, userId, expiresAt })
}

export function createDeviceConflictToken(userId: string, deviceId: string, expiresAt: string) {
  return createSignedToken<DeviceConflictTokenClaims>({ kind: 'device_conflict', userId, deviceId, expiresAt })
}

export function createMobileStepUpToken(userId: string, phoneNumber: string, expiresAt: string) {
  return createSignedToken<MobileStepUpTokenClaims>({ kind: 'mobile_step_up', userId, phoneNumber, expiresAt })
}

export function verifyFlowToken(token: string, expectedFlowId: string): VerifyFlowTokenResult {
  const verified = verifyClaims<FlowTokenClaims>(token)
  if (!verified.ok) {
    return verified
  }
  if (verified.claims.kind !== 'flow' || verified.claims.flowId !== expectedFlowId) {
    return { ok: false, reason: 'invalid' }
  }
  return verified
}

export function verifyServiceToken(token: string, expectedService: string): VerifyServiceTokenResult {
  const verified = verifyClaims<ServiceTokenClaims>(token)
  if (!verified.ok) {
    return verified
  }
  if (verified.claims.kind !== 'service' || verified.claims.service !== expectedService) {
    return { ok: false, reason: 'invalid' }
  }
  return verified
}

export function verifyServiceResultToken(token: string, expectedFlowId: string): VerifyServiceResultTokenResult {
  const verified = verifyClaims<ServiceResultTokenClaims>(token)
  if (!verified.ok) {
    return verified
  }
  if (verified.claims.kind !== 'service_result' || verified.claims.flowId !== expectedFlowId) {
    return { ok: false, reason: 'invalid' }
  }
  return verified
}

export function verifyPasswordSetupToken(token: string, expectedFlowId: string, expectedUserId: string): VerifyPasswordSetupTokenResult {
  const verified = verifyClaims<PasswordSetupTokenClaims>(token)
  if (!verified.ok) {
    return verified
  }
  if (verified.claims.kind !== 'password_setup' || verified.claims.flowId !== expectedFlowId || verified.claims.userId !== expectedUserId) {
    return { ok: false, reason: 'invalid' }
  }
  return verified
}

export function verifyDeviceConflictToken(token: string, expectedUserId: string, expectedDeviceId: string): VerifyDeviceConflictTokenResult {
  const verified = verifyClaims<DeviceConflictTokenClaims>(token)
  if (!verified.ok) {
    return verified
  }
  if (verified.claims.kind !== 'device_conflict' || verified.claims.userId !== expectedUserId || verified.claims.deviceId !== expectedDeviceId) {
    return { ok: false, reason: 'invalid' }
  }
  return verified
}

export function verifyMobileStepUpToken(token: string, expectedUserId: string, expectedPhoneNumber: string): VerifyMobileStepUpTokenResult {
  const verified = verifyClaims<MobileStepUpTokenClaims>(token)
  if (!verified.ok) {
    return verified
  }
  if (verified.claims.kind !== 'mobile_step_up' || verified.claims.userId !== expectedUserId || verified.claims.phoneNumber !== expectedPhoneNumber) {
    return { ok: false, reason: 'invalid' }
  }
  return verified
}

function verifyClaims<T extends BaseTokenClaims>(token: string): { ok: true; claims: T } | { ok: false; reason: 'invalid' | 'expired' } {
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

    const claims = JSON.parse(decodeBase64Url(payload)) as Partial<T>
    if (typeof claims.expiresAt !== 'string' || typeof claims.kind !== 'string') {
      return { ok: false, reason: 'invalid' }
    }
    if (Number.isNaN(Date.parse(claims.expiresAt)) || Date.parse(claims.expiresAt) < Date.now()) {
      return { ok: false, reason: 'expired' }
    }

    return {
      ok: true,
      claims: claims as T
    }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

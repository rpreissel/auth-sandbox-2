import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import { appConfig, keycloakConfig } from '@auth-sandbox-2/backend-core'

export type SsoBootstrapTargetId = 'webmock'
export type SsoBootstrapRequestedAcr = '1se' | '2se'

export type SsoBootstrapTarget = {
  id: SsoBootstrapTargetId
  clientId: string
  publicUrl: string
}

export type SsoBootstrapStateClaims = {
  kind: 'sso_bootstrap'
  jti: string
  targetId: SsoBootstrapTargetId
  targetClientId: string
  targetPath: string
  requestedAcr: SsoBootstrapRequestedAcr
  exp: number
}

type VerifySsoBootstrapStateResult =
  | { ok: true; claims: SsoBootstrapStateClaims }
  | { ok: false; reason: 'invalid' | 'expired' }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isSsoBootstrapTargetId(value: string): value is SsoBootstrapTargetId {
  return value === 'webmock'
}

function isValidExp(value: number) {
  return Number.isInteger(value) && Number.isSafeInteger(value) && value > 0
}

function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function getSsoStateSecret() {
  if (typeof (appConfig as { ssoStateSecret?: unknown }).ssoStateSecret === 'string') {
    return (appConfig as { ssoStateSecret: string }).ssoStateSecret
  }

  return process.env.AUTH_API_SSO_STATE_SECRET ?? 'change-me-sso-state-secret'
}

function getBrowserClientId() {
  if (typeof (keycloakConfig as { browserClientId?: unknown }).browserClientId === 'string') {
    return (keycloakConfig as { browserClientId: string }).browserClientId
  }

  return process.env.KEYCLOAK_BROWSER_CLIENT_ID ?? 'webmock-web'
}

function getWebmockWebPublicUrl() {
  if (typeof (appConfig as { webmockWebPublicUrl?: unknown }).webmockWebPublicUrl === 'string') {
    return (appConfig as { webmockWebPublicUrl: string }).webmockWebPublicUrl
  }

  return process.env.WEBMOCK_WEB_PUBLIC_URL ?? 'https://webmock.localhost:8443/'
}

function getSsoBootstrapTargets(): Record<SsoBootstrapTargetId, SsoBootstrapTarget> {
  return {
    webmock: {
      id: 'webmock',
      clientId: getBrowserClientId(),
      publicUrl: getWebmockWebPublicUrl()
    }
  }
}

function getSsoStateTtlSeconds() {
  if (typeof (appConfig as { ssoStateTtlSeconds?: unknown }).ssoStateTtlSeconds === 'number') {
    return (appConfig as { ssoStateTtlSeconds: number }).ssoStateTtlSeconds
  }

  return Number.parseInt(process.env.AUTH_API_SSO_STATE_TTL_SECONDS ?? '300', 10)
}

function signPayload(payload: string) {
  return createHmac('sha256', getSsoStateSecret()).update(payload).digest()
}

function createSignedState(claims: SsoBootstrapStateClaims) {
  const payload = encodeBase64Url(JSON.stringify(claims))
  const signature = encodeBase64Url(signPayload(payload))
  return `${payload}.${signature}`
}

export function listSsoBootstrapTargets() {
  return Object.values(getSsoBootstrapTargets())
}

export function getSsoBootstrapTarget(targetId: SsoBootstrapTargetId) {
  return getSsoBootstrapTargets()[targetId]
}

export function normalizeSsoBootstrapTargetPath(targetPath?: string | null) {
  if (!targetPath || targetPath.trim().length === 0) {
    return '/'
  }

  if (!targetPath.startsWith('/')) {
    throw new Error('Bootstrap target path must start with /')
  }

  return targetPath
}

export function buildSsoBootstrapTargetUrl(target: SsoBootstrapTarget, targetPath?: string | null) {
  const normalizedPath = normalizeSsoBootstrapTargetPath(targetPath)
  const baseUrl = new URL(target.publicUrl)
  const nextUrl = new URL(normalizedPath, baseUrl)

  if (nextUrl.origin !== baseUrl.origin) {
    throw new Error('Bootstrap target path must stay on the allowlisted origin')
  }

  return nextUrl.toString()
}

export function createSsoBootstrapState(input: {
  targetId: SsoBootstrapTargetId
  targetPath?: string | null
  requestedAcr: SsoBootstrapRequestedAcr
}) {
  const target = getSsoBootstrapTarget(input.targetId)
  const exp = Math.floor(Date.now() / 1000) + getSsoStateTtlSeconds()

  return createSignedState({
    kind: 'sso_bootstrap',
    jti: randomUUID(),
    targetId: target.id,
    targetClientId: target.clientId,
    targetPath: normalizeSsoBootstrapTargetPath(input.targetPath),
    requestedAcr: input.requestedAcr,
    exp
  })
}

export function verifySsoBootstrapState(token: string): VerifySsoBootstrapStateResult {
  const parts = token.split('.')
  if (parts.length !== 2) {
    return { ok: false, reason: 'invalid' }
  }

  const [payload, signature] = parts
  if (payload.length === 0 || signature.length === 0) {
    return { ok: false, reason: 'invalid' }
  }

  try {
    const expectedSignature = signPayload(payload)
    const actualSignature = Buffer.from(signature, 'base64url')

    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
      return { ok: false, reason: 'invalid' }
    }

    const claims = JSON.parse(decodeBase64Url(payload)) as Partial<SsoBootstrapStateClaims>
    if (
      claims.kind !== 'sso_bootstrap' ||
      typeof claims.jti !== 'string' ||
      !UUID_PATTERN.test(claims.jti) ||
      typeof claims.targetId !== 'string' ||
      !isSsoBootstrapTargetId(claims.targetId) ||
      typeof claims.targetClientId !== 'string' ||
      claims.targetClientId.length === 0 ||
      typeof claims.targetPath !== 'string' ||
      claims.targetPath !== normalizeSsoBootstrapTargetPath(claims.targetPath) ||
      (claims.requestedAcr !== '1se' && claims.requestedAcr !== '2se') ||
      typeof claims.exp !== 'number' ||
      !isValidExp(claims.exp)
    ) {
      return { ok: false, reason: 'invalid' }
    }

    if (claims.exp <= Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: 'expired' }
    }

    const target = getSsoBootstrapTargets()[claims.targetId]
    if (!target || target.clientId !== claims.targetClientId) {
      return { ok: false, reason: 'invalid' }
    }

    try {
      buildSsoBootstrapTargetUrl(target, claims.targetPath)
    } catch {
      return { ok: false, reason: 'invalid' }
    }

    return {
      ok: true,
      claims: claims as SsoBootstrapStateClaims
    }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

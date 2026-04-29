import { createHash } from 'node:crypto'
import { generateKeyPairSync } from 'node:crypto'

import type { FastifyRequest } from 'fastify'
import { calculateJwkThumbprint, exportJWK, importJWK, jwtVerify, SignJWT } from 'jose'
import { z } from 'zod'

import type { CreateTanMockAdminRecordInput, JsonObject } from '@auth-sandbox-2/shared-types'

import { tanMockApiConfig } from './config.js'
import { fetchSourceIdentity } from './keycloak.js'
import {
  consumeActiveTan,
  createAuthorizationCode,
  createEntry,
  createRefreshToken,
  listOverview,
  useAuthorizationCode,
  useRefreshToken
} from './store.js'

const authorizeQuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  scope: z.string().min(1),
  state: z.string().optional(),
  nonce: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional()
})

const loginBodySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  scope: z.string().min(1),
  state: z.string().optional(),
  nonce: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  userId: z.string().trim().min(1),
  tan: z.string().trim().min(1)
})

const tokenBodySchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  code: z.string().optional(),
  redirect_uri: z.string().url().optional(),
  refresh_token: z.string().optional(),
  client_id: z.string().min(1),
  client_secret: z.string().optional(),
  code_verifier: z.string().optional()
})

const adminCreateSchema = z.object({
  tan: z.string().trim().min(4),
  sourceUserId: z.string().trim().min(1)
})

const keyPair = generateKeyPairSync('rsa', {
  modulusLength: 2048
})
const signingKey = keyPair.privateKey
const publicJwk = await exportJWK(keyPair.publicKey)
const signingKeyId = await calculateJwkThumbprint(publicJwk)
const verificationKey = await importJWK({
  ...publicJwk,
  alg: 'RS256'
}, 'RS256')

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function verifyPkce(codeVerifier: string | undefined, codeChallenge: string | null, codeChallengeMethod: string | null) {
  if (!codeChallenge) {
    return true
  }
  if (!codeVerifier) {
    return false
  }
  if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
    return false
  }
  const expected = createHash('sha256').update(codeVerifier).digest('base64url')
  return expected === codeChallenge
}

function createLoginPage(args: {
  error?: string
  clientId: string
  redirectUri: string
  scope: string
  state?: string
  nonce?: string
  codeChallenge?: string
  codeChallengeMethod?: string
  userId?: string
}) {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TAN Mock Login</title>
    <style>
      :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(180deg, #eef4fb, #dce8f5); color: #102033; }
      main { width: min(420px, calc(100vw - 2rem)); background: rgba(255,255,255,0.95); border-radius: 28px; padding: 1.4rem; box-shadow: 0 24px 48px rgba(16,32,51,0.12); }
      h1 { margin: 0 0 0.5rem; font-size: 1.8rem; }
      p { line-height: 1.45; }
      form { display: grid; gap: 0.85rem; margin-top: 1rem; }
      label { display: grid; gap: 0.35rem; font-size: 0.92rem; font-weight: 600; }
      input { border: 1px solid #b7c7da; border-radius: 14px; padding: 0.8rem 0.9rem; font: inherit; }
      button { border: 0; border-radius: 14px; padding: 0.9rem 1rem; background: #0b57d0; color: white; font: inherit; font-weight: 700; cursor: pointer; }
      .eyebrow { text-transform: uppercase; letter-spacing: 0.08em; color: #4c647f; font-size: 0.76rem; }
      .error { border-radius: 14px; padding: 0.8rem 0.9rem; background: #fff0f0; color: #8d1f1f; }
      .hint { font-size: 0.88rem; color: #557089; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Mock OIDC Identity Provider</p>
      <h1>Mit User ID und TAN anmelden</h1>
      <p>Jede gueltige TAN wird genau einmal verbraucht und erzeugt einen neuen brokered User in Keycloak.</p>
      ${args.error ? `<p class="error">${escapeHtml(args.error)}</p>` : ''}
      <form method="post" action="/oidc/login">
        <input type="hidden" name="client_id" value="${escapeHtml(args.clientId)}" />
        <input type="hidden" name="redirect_uri" value="${escapeHtml(args.redirectUri)}" />
        <input type="hidden" name="scope" value="${escapeHtml(args.scope)}" />
        <input type="hidden" name="state" value="${escapeHtml(args.state ?? '')}" />
        <input type="hidden" name="nonce" value="${escapeHtml(args.nonce ?? '')}" />
        <input type="hidden" name="code_challenge" value="${escapeHtml(args.codeChallenge ?? '')}" />
        <input type="hidden" name="code_challenge_method" value="${escapeHtml(args.codeChallengeMethod ?? '')}" />
        <label>User ID<input name="userId" value="${escapeHtml(args.userId ?? '')}" autocomplete="username" /></label>
        <label>TAN<input name="tan" inputmode="numeric" autocomplete="one-time-code" /></label>
        <button type="submit">Anmeldung fortsetzen</button>
      </form>
      <p class="hint">Client: ${escapeHtml(args.clientId)}</p>
    </main>
  </body>
</html>`
}

function buildTanIdentityHash(tan: string) {
  return createHash('sha256').update(tan).digest('hex').slice(0, 12)
}

function isDuplicateTanError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes('tanmock_entries_tan_key')
    || error.message.includes('idx_tanmock_entries_user_tan_unique')
    || error.message.includes('idx_tanmock_entries_source_user_tan_unique')
}

async function getSourceIdentityClaims(sourceUserId: string) {
  const identity = await fetchSourceIdentity(sourceUserId)
  if (!identity) {
    throw new Error(`Unknown source registration identity ${sourceUserId}`)
  }

  return identity
}

function sanitizeClaimValue(value: unknown): JsonObject[string] {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry) || entry === null) as JsonObject[string]
  }
  if (typeof value === 'object') {
    const next: JsonObject = {}
    for (const [key, nested] of Object.entries(value)) {
      const sanitized = sanitizeClaimValue(nested)
      if (sanitized !== undefined) {
        next[key] = sanitized
      }
    }
    return next
  }
  return undefined
}

function buildBrokerClaims(args: {
  tan: string
  sourceUserId: string
  sourceIdentity: {
    firstName: string
    lastName: string
    phoneNumber: string | null
  }
}): JsonObject {
  const tanHash = buildTanIdentityHash(args.tan)
  const brokerUsername = `tan_${args.sourceUserId}_${tanHash}`
  const displayName = `Tan ${tanHash}`

  const claims: JsonObject = {
    sub: brokerUsername,
    tan_sub: brokerUsername,
    preferred_username: brokerUsername,
    userId: brokerUsername,
    email: `${brokerUsername}@tanmock.localhost`,
    email_verified: false,
    given_name: 'Tan',
    family_name: tanHash,
    name: displayName,
    source_user_id: args.sourceUserId
  }

  claims.source_identity_first_name = sanitizeClaimValue(args.sourceIdentity.firstName)
  claims.source_identity_last_name = sanitizeClaimValue(args.sourceIdentity.lastName)
  claims.source_identity_phone_number = sanitizeClaimValue(args.sourceIdentity.phoneNumber)

  return claims
}

async function signTokens(args: {
  brokerUsername: string
  scope: string
  claims: JsonObject
  nonce?: string | null
}) {
  const now = Math.floor(Date.now() / 1000)
  const accessToken = await new SignJWT({
    ...args.claims,
    scope: args.scope,
    typ: 'Bearer'
  })
    .setProtectedHeader({ alg: 'RS256', kid: signingKeyId, typ: 'JWT' })
    .setIssuer(tanMockApiConfig.issuer)
    .setAudience(tanMockApiConfig.clientId)
    .setSubject(args.brokerUsername)
    .setIssuedAt(now)
    .setExpirationTime(now + tanMockApiConfig.accessTokenTtlSeconds)
    .sign(signingKey)

  const idTokenClaims = args.nonce
    ? { ...args.claims, nonce: args.nonce }
    : args.claims

  const idToken = await new SignJWT(idTokenClaims)
    .setProtectedHeader({ alg: 'RS256', kid: signingKeyId, typ: 'JWT' })
    .setIssuer(tanMockApiConfig.issuer)
    .setAudience(tanMockApiConfig.clientId)
    .setSubject(args.brokerUsername)
    .setIssuedAt(now)
    .setExpirationTime(now + tanMockApiConfig.accessTokenTtlSeconds)
    .sign(signingKey)

  const refreshToken = await createRefreshToken({
    brokerUsername: args.brokerUsername,
    sourceUserId: String(args.claims.source_user_id ?? ''),
    claims: args.claims,
    expiresAt: new Date(Date.now() + tanMockApiConfig.refreshTokenTtlSeconds * 1000)
  })

  return {
    access_token: accessToken,
    id_token: idToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: tanMockApiConfig.accessTokenTtlSeconds,
    scope: args.scope
  }
}

export async function registerRoutes(app: any) {
  app.get('/health', async () => ({ status: 'ok', service: 'tanmock-api' }))

  app.get('/.well-known/openid-configuration', async () => ({
    issuer: tanMockApiConfig.issuer,
    authorization_endpoint: `${tanMockApiConfig.publicUrl}/oidc/authorize`,
    token_endpoint: `${tanMockApiConfig.publicUrl}/oidc/token`,
    userinfo_endpoint: `${tanMockApiConfig.publicUrl}/oidc/userinfo`,
    jwks_uri: `${tanMockApiConfig.publicUrl}/oidc/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    claims_supported: ['sub', 'tan_sub', 'preferred_username', 'userId', 'email', 'email_verified', 'given_name', 'family_name', 'name']
  }))

  app.get('/oidc/jwks', async () => ({ keys: [{ ...publicJwk, kid: signingKeyId, alg: 'RS256', use: 'sig' }] }))

  app.get('/oidc/authorize', async (request: FastifyRequest, reply: any) => {
    const query = authorizeQuerySchema.parse(request.query)
    if (query.client_id !== tanMockApiConfig.clientId) {
      reply.code(400)
      return { message: 'Unknown client_id' }
    }
    reply.type('text/html; charset=utf-8')
    return createLoginPage({
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      scope: query.scope,
      state: query.state,
      nonce: query.nonce,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method
    })
  })

  app.post('/oidc/login', async (request: FastifyRequest, reply: any) => {
    const body = loginBodySchema.parse(request.body)
    if (body.client_id !== tanMockApiConfig.clientId) {
      reply.code(400)
      return { message: 'Unknown client_id' }
    }

    if (body.userId !== body.userId.trim()) {
      reply.type('text/html; charset=utf-8')
      return createLoginPage({
        clientId: body.client_id,
        redirectUri: body.redirect_uri,
        scope: body.scope,
        state: body.state,
        nonce: body.nonce,
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge_method,
        userId: body.userId,
        error: 'User ID ist ungueltig.'
      })
    }

    const entry = await consumeActiveTan(body.userId, body.tan)
    if (!entry) {
      reply.type('text/html; charset=utf-8')
      return createLoginPage({
        clientId: body.client_id,
        redirectUri: body.redirect_uri,
        scope: body.scope,
        state: body.state,
        nonce: body.nonce,
        codeChallenge: body.code_challenge,
        codeChallengeMethod: body.code_challenge_method,
        userId: body.userId,
        error: 'Die TAN ist ungueltig, verbraucht oder nicht fuer diese User ID freigegeben.'
      })
    }

    const sourceIdentity = await getSourceIdentityClaims(entry.sourceUserId)
    const brokerUsername = `tan_${entry.sourceUserId}_${buildTanIdentityHash(entry.tan)}`
    const claims = buildBrokerClaims({
      tan: entry.tan,
      sourceUserId: entry.sourceUserId,
      sourceIdentity
    })

    const code = await createAuthorizationCode({
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      scope: body.scope,
      state: body.state,
      nonce: body.nonce,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
      brokerUsername,
      sourceUserId: entry.sourceUserId,
      claims,
      expiresAt: new Date(Date.now() + tanMockApiConfig.authCodeTtlSeconds * 1000)
    })

    const redirectUrl = new URL(body.redirect_uri)
    redirectUrl.searchParams.set('code', code)
    if (body.state) {
      redirectUrl.searchParams.set('state', body.state)
    }
    reply.redirect(redirectUrl.toString())
  })

  app.post('/oidc/token', async (request: FastifyRequest, reply: any) => {
    const body = tokenBodySchema.parse(request.body)
    if (body.client_id !== tanMockApiConfig.clientId || body.client_secret !== tanMockApiConfig.clientSecret) {
      reply.code(401)
      return { error: 'invalid_client' }
    }

    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.redirect_uri) {
        reply.code(400)
        return { error: 'invalid_request' }
      }
      const code = await useAuthorizationCode(body.code)
      if (!code || code.redirect_uri !== body.redirect_uri || !verifyPkce(body.code_verifier, code.code_challenge, code.code_challenge_method)) {
        reply.code(400)
        return { error: 'invalid_grant' }
      }

      return signTokens({
        brokerUsername: code.broker_username,
        scope: code.scope,
        claims: code.claims_json,
        nonce: code.nonce
      })
    }

    const refreshToken = body.refresh_token ? await useRefreshToken(body.refresh_token) : null
    if (!refreshToken) {
      reply.code(400)
      return { error: 'invalid_grant' }
    }

    return signTokens({
      brokerUsername: refreshToken.broker_username,
      scope: 'openid profile email',
      claims: refreshToken.claims_json
    })
  })

  app.get('/oidc/userinfo', async (request: FastifyRequest, reply: any) => {
    const authorization = request.headers.authorization
    if (!authorization?.startsWith('Bearer ')) {
      reply.code(401)
      return { error: 'invalid_token' }
    }

    const { payload } = await jwtVerify(authorization.slice('Bearer '.length), verificationKey, {
      issuer: tanMockApiConfig.issuer,
      audience: tanMockApiConfig.clientId
    })
    return payload
  })

  app.get('/api/admin/entries', async (request: FastifyRequest, reply: any) => {
    return listOverview()
  })

  app.post('/api/admin/entries', async (request: FastifyRequest, reply: any) => {
    const body = adminCreateSchema.parse(request.body) satisfies CreateTanMockAdminRecordInput
    const sourceIdentity = await fetchSourceIdentity(body.sourceUserId)
    if (!sourceIdentity) {
      reply.code(400)
      return { message: `Unknown source registration identity ${body.sourceUserId}` }
    }

    let created
    try {
      created = await createEntry(body)
    } catch (error) {
      if (isDuplicateTanError(error)) {
        reply.code(400)
        return { message: `TAN ${body.tan} existiert fuer Quelle ${body.sourceUserId} bereits.` }
      }

      throw error
    }

    reply.code(201)
    return created
  })
}

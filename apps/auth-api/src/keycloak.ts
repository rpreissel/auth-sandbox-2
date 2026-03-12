import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID, webcrypto } from 'node:crypto'

import type { TokenBundle } from '@auth-sandbox-2/shared-types'

import { appConfig, keycloakConfig } from './config.js'
import { decodeTokenClaims } from './lib/jwt.js'
import { buildTraceHeaders, recordArtifact, recordHttpExchange, runWithSpan } from './observability.js'

type KeycloakTokenResponse = {
  access_token: string
  expires_in: number
  refresh_expires_in?: number
  refresh_token: string
  token_type: string
  id_token: string
  scope: string
}

type CredentialRepresentation = {
  id: string
  type: string
  userLabel?: string
  credentialData?: string
  secretData?: string
}

type CreateDeviceCredentialResponse = {
  credentialId: string
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const { data } = await performObservedRequest<T>(input, init)
  return data
}

async function fetchNoContent(input: string, init?: RequestInit) {
  const { response } = await performObservedRequest(input, init)
  return response
}

function createFormBody(values: Record<string, string>) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    body.set(key, value)
  }
  return body
}

async function performObservedRequest<T>(input: string, init?: RequestInit) {
  const method = init?.method ?? 'GET'
  const requestHeaders = new Headers(init?.headers)
  const traceHeaders = buildTraceHeaders()
  for (const [key, value] of Object.entries(traceHeaders)) {
    requestHeaders.set(key, value)
  }

  const bodyText = serializeRequestBody(init?.body)

  return runWithSpan(
    {
      kind: 'http_out',
      actorType: 'backend',
      actorName: 'keycloak',
      targetName: 'keycloak',
      operation: `${method} ${new URL(input).pathname}`,
      method,
      url: input,
      notes: 'Outgoing Keycloak call captured with full demo payload logging.'
    },
    async (spanId) => {
      const response = await fetch(input, {
        ...init,
        headers: requestHeaders
      })
      const responseText = await response.text()

      await recordHttpExchange({
        spanId,
        requestHeaders,
        requestBody: bodyText,
        responseHeaders: response.headers,
        responseBody: responseText,
        requestContentType: requestHeaders.get('content-type'),
        responseContentType: response.headers.get('content-type')
      })

      if (!response.ok && response.status !== 204 && response.status !== 201) {
        await recordArtifact({
          spanId,
          artifactType: 'error',
          name: 'keycloak_error_response',
          contentType: response.headers.get('content-type') ?? 'text/plain',
          encoding: 'raw',
          direction: 'inbound',
          rawValue: responseText,
          explanation: 'Keycloak returned a non-success HTTP status.'
        })
        throw new Error(`${method} ${input} failed: ${response.status} ${responseText}`)
      }

      const contentType = response.headers.get('content-type') ?? ''
      const data = contentType.includes('application/json') && responseText.length > 0
        ? JSON.parse(responseText) as T
        : undefined

      if (hasJwtField(data, 'access_token')) {
        await recordArtifact({
          spanId,
          artifactType: 'jwt',
          name: 'access_token',
          contentType: 'application/jwt',
          encoding: 'jwt',
          direction: 'inbound',
          rawValue: data.access_token,
          explanation: 'Decoded Keycloak access token stored for demo trace inspection.'
        })
      }

      if (hasJwtField(data, 'id_token')) {
        await recordArtifact({
          spanId,
          artifactType: 'jwt',
          name: 'id_token',
          contentType: 'application/jwt',
          encoding: 'jwt',
          direction: 'inbound',
          rawValue: data.id_token,
          explanation: 'Decoded Keycloak ID token stored for demo trace inspection.'
        })
      }

      if (hasJwtField(data, 'refresh_token')) {
        await recordArtifact({
          spanId,
          artifactType: 'jwt',
          name: 'refresh_token',
          contentType: 'application/jwt',
          encoding: 'jwt',
          direction: 'inbound',
          rawValue: data.refresh_token,
          explanation: 'Decoded Keycloak refresh token stored for demo trace inspection.'
        })
      }

      return {
        data: data as T,
        response
      }
    }
  )
}

function serializeRequestBody(body: RequestInit['body']) {
  if (!body) {
    return null
  }

  if (typeof body === 'string') {
    return body
  }

  if (body instanceof URLSearchParams) {
    return body.toString()
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('base64')
  }

  return String(body)
}

function isTokenResponse(value: unknown): value is KeycloakTokenResponse {
  return typeof value === 'object' && value !== null && 'access_token' in value && 'id_token' in value && 'refresh_token' in value
}

function hasJwtField<T extends string>(value: unknown, field: T): value is Record<T, string> {
  return typeof value === 'object' && value !== null && field in value && typeof (value as Record<string, unknown>)[field] === 'string'
}

export class KeycloakAdminClient {
  async getAdminToken() {
    const body = createFormBody({
      grant_type: 'client_credentials',
      client_id: keycloakConfig.adminClientId,
      client_secret: keycloakConfig.adminClientSecret
    })

    const token = await fetchJson<{ access_token: string }>(
      `${keycloakConfig.baseUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body
      }
    )

    return token.access_token
  }

  async ensureUser(userId: string, displayName?: string) {
    const existing = await this.getUserByUsername(userId)
    if (existing) {
      return existing.id
    }

    const token = await this.getAdminToken()
    const [firstName, ...rest] = (displayName ?? userId).trim().split(' ')
    await fetchNoContent(`${keycloakConfig.baseUrl}/admin/realms/${keycloakConfig.realm}/users`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        username: userId,
        enabled: true,
        emailVerified: false,
        requiredActions: [],
        firstName,
        lastName: rest.join(' ') || undefined
      })
    })

    const created = await this.getUserByUsername(userId)
    if (!created) {
      throw new Error(`Failed to create Keycloak user for ${userId}`)
    }
    return created.id
  }

  async getUserByUsername(userId: string) {
    const token = await this.getAdminToken()
    const users = await fetchJson<Array<{ id: string; username: string }>>(
      `${keycloakConfig.baseUrl}/admin/realms/${keycloakConfig.realm}/users?username=${encodeURIComponent(userId)}&exact=true`,
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    )
    return users[0]
  }

  async getUserById(userId: string) {
    return this.getUserByUsername(userId)
  }

  async getCredentials(userId: string) {
    const user = await this.getUserByUsername(userId)
    if (!user) {
      throw new Error(`Unknown Keycloak user ${userId}`)
    }
    const token = await this.getAdminToken()
    return fetchJson<CredentialRepresentation[]>(
      `${keycloakConfig.baseUrl}/admin/realms/${keycloakConfig.realm}/users/${user.id}/credentials`,
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    )
  }

  async hasPassword(userId: string) {
    const credentials = await this.getCredentials(userId)
    return credentials.some((credential) => credential.type === 'password')
  }

  async setPassword(userId: string, password: string) {
    const user = await this.getUserByUsername(userId)
    if (!user) {
      throw new Error(`Unknown Keycloak user ${userId}`)
    }
    const token = await this.getAdminToken()
    await fetchNoContent(
      `${keycloakConfig.baseUrl}/admin/realms/${keycloakConfig.realm}/users/${user.id}/reset-password`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          type: 'password',
          temporary: false,
          value: password
        })
      }
    )
  }

  async createDeviceCredential(args: {
    userId: string
    deviceName: string
    publicKey: string
    publicKeyHash: string
    encPrivKey: string
  }) {
    const user = await this.getUserByUsername(args.userId)
    if (!user) {
      throw new Error(`Unknown Keycloak user ${args.userId}`)
    }
    const token = await this.getAdminToken()
    const created = await fetchJson<CreateDeviceCredentialResponse>(
      `${keycloakConfig.baseUrl}/realms/${keycloakConfig.realm}/device-credentials`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          keycloakUserId: user.id,
          deviceName: args.deviceName,
          publicKey: args.publicKey,
          publicKeyHash: args.publicKeyHash,
          encPrivKey: args.encPrivKey
        })
      }
    )

    return created.credentialId
  }

  async deleteDeviceCredential(userId: string, credentialId: string) {
    const user = await this.getUserByUsername(userId)
    if (!user) {
      return
    }
    const token = await this.getAdminToken()
    await fetchNoContent(
      `${keycloakConfig.baseUrl}/admin/realms/${keycloakConfig.realm}/users/${user.id}/credentials/${credentialId}`,
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    )
  }
}

export class KeycloakAuthClient {
  async authenticate(loginToken: string) {
    const codeVerifier = randomBytes(32).toString('base64url')
    const digest = await webcrypto.subtle.digest('SHA-256', Buffer.from(codeVerifier))
    const codeChallenge = Buffer.from(digest).toString('base64url')
    const state = randomUUID()

    const authUrl = new URL(`${keycloakConfig.baseUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/auth`)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('client_id', keycloakConfig.clientId)
    authUrl.searchParams.set('redirect_uri', `${appConfig.publicUrl}/blank`)
    authUrl.searchParams.set('scope', 'openid profile email offline_access')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('login_token', loginToken)

    const response = await fetch(authUrl, { redirect: 'manual' })
    const location = response.headers.get('location')
    if (!location) {
      throw new Error(`Missing Keycloak redirect location: ${response.status}`)
    }

    const redirected = new URL(location)
    if (redirected.searchParams.get('state') !== state) {
      throw new Error('Keycloak state mismatch')
    }

    const code = redirected.searchParams.get('code')
    if (!code) {
      throw new Error(`Missing code from Keycloak redirect: ${location}`)
    }

    return this.exchangeAuthorizationCode(code, codeVerifier)
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string) {
    const body = createFormBody({
      grant_type: 'authorization_code',
      client_id: keycloakConfig.clientId,
      client_secret: keycloakConfig.clientSecret,
      redirect_uri: `${appConfig.publicUrl}/blank`,
      code,
      code_verifier: codeVerifier
    })

    const response = await fetchJson<KeycloakTokenResponse>(
      `${keycloakConfig.baseUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body
      }
    )

    return toTokenBundle(response)
  }

  async refresh(refreshToken: string) {
    const body = createFormBody({
      grant_type: 'refresh_token',
      client_id: keycloakConfig.clientId,
      client_secret: keycloakConfig.clientSecret,
      refresh_token: refreshToken
    })

    const response = await fetchJson<KeycloakTokenResponse>(
      `${keycloakConfig.baseUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body
      }
    )

    return toTokenBundle(response)
  }

  async logout(refreshToken: string) {
    const body = createFormBody({
      client_id: keycloakConfig.clientId,
      client_secret: keycloakConfig.clientSecret,
      refresh_token: refreshToken
    })

    await fetchNoContent(`${keycloakConfig.baseUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    })
  }
}

function toTokenBundle(tokens: KeycloakTokenResponse): TokenBundle {
  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token,
    tokenType: tokens.token_type,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    accessTokenClaims: decodeTokenClaims(tokens.access_token),
    idTokenClaims: decodeTokenClaims(tokens.id_token)
  }
}

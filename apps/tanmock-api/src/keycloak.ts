import { createRemoteJWKSet, jwtVerify } from 'jose'

import { tanMockApiConfig } from './config.js'

const keycloakJwks = createRemoteJWKSet(new URL(`${tanMockApiConfig.keycloakBaseUrl}/realms/${tanMockApiConfig.keycloakRealm}/protocol/openid-connect/certs`))

type KeycloakAdminClaims = {
  sub?: string
  preferred_username?: string
  azp?: string
  realm_access?: {
    roles?: string[]
  }
  resource_access?: Record<string, { roles?: string[] }>
}

export async function verifyAdminAccessToken(token: string) {
  const { payload } = await jwtVerify(token, keycloakJwks, {
    issuer: `${tanMockApiConfig.keycloakPublicUrl}/realms/${tanMockApiConfig.keycloakRealm}`
  })

  const claims = payload as KeycloakAdminClaims
  const roles = new Set<string>([
    ...(claims.realm_access?.roles ?? []),
    ...(claims.resource_access?.[tanMockApiConfig.clientId]?.roles ?? []),
    ...(claims.resource_access?.[tanMockApiConfig.adminClientId]?.roles ?? [])
  ])

  const hasExpectedIdentity = claims.preferred_username === 'tanmock-admin' && claims.azp === tanMockApiConfig.adminClientId
  if (!hasExpectedIdentity && !roles.has('tanmock-admin')) {
    throw new Error('Missing tanmock-admin role')
  }

  return claims
}

export async function fetchSourceUser(sourceUserId: string) {
  const tokenResponse = await fetch(`${tanMockApiConfig.keycloakBaseUrl}/realms/${tanMockApiConfig.keycloakRealm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: tanMockApiConfig.keycloakAdminClientId,
      client_secret: tanMockApiConfig.keycloakAdminClientSecret
    })
  })

  if (!tokenResponse.ok) {
    throw new Error('Failed to authenticate against Keycloak admin API')
  }

  const tokenBody = await tokenResponse.json() as { access_token: string }
  const userResponse = await fetch(`${tanMockApiConfig.keycloakBaseUrl}/admin/realms/${tanMockApiConfig.keycloakRealm}/users?username=${encodeURIComponent(sourceUserId)}&exact=true`, {
    headers: { authorization: `Bearer ${tokenBody.access_token}` }
  })

  if (!userResponse.ok) {
    throw new Error('Failed to fetch source Keycloak user')
  }

  const users = await userResponse.json() as Array<Record<string, unknown>>
  return users[0] ?? null
}

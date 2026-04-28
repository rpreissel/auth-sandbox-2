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

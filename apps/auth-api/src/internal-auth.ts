import type { JWTPayload } from 'jose'

export type InternalRedeemAccessTokenClaims = JWTPayload & {
  azp?: string
  client_id?: string
}

export function isAllowedInternalRedeemTokenClaims(claims: InternalRedeemAccessTokenClaims, expectedClientId: string) {
  const clientId = claims.azp ?? claims.client_id
  if (clientId !== expectedClientId) {
    return false
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : typeof claims.aud === 'string' ? [claims.aud] : []
  return audiences.includes('account')
}

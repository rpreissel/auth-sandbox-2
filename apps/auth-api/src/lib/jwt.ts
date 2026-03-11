import { decodeJwt } from 'jose'

import type { JwtClaims } from '@auth-sandbox-2/shared-types'

export function decodeTokenClaims(token: string): JwtClaims {
  return decodeJwt(token) as JwtClaims
}

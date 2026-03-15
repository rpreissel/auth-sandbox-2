import { describe, expect, it } from 'vitest'

import { isAllowedInternalRedeemTokenClaims } from './internal-auth.js'

describe('internal redeem token claims', () => {
  it('accepts the configured service-account client with account audience', () => {
    expect(isAllowedInternalRedeemTokenClaims({
      azp: 'auth-api-internal-redeem',
      aud: ['account']
    }, 'auth-api-internal-redeem')).toBe(true)
  })

  it('rejects a different client id', () => {
    expect(isAllowedInternalRedeemTokenClaims({
      azp: 'some-other-client',
      aud: ['account']
    }, 'auth-api-internal-redeem')).toBe(false)
  })

  it('rejects tokens without the account audience', () => {
    expect(isAllowedInternalRedeemTokenClaims({
      azp: 'auth-api-internal-redeem',
      aud: ['custom-audience']
    }, 'auth-api-internal-redeem')).toBe(false)
  })
})

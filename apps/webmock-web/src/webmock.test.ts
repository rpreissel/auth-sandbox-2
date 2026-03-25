import { describe, expect, it } from 'vitest'

import { buildAuthorizationUrl, getServiceMockApiAccessLabel, satisfiesAssuranceLevel } from './state'

describe('webmock helpers', () => {
  it('builds a browser authorization request with acr values', () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: 'https://keycloak.localhost:8443/realms/auth-sandbox-2/protocol/openid-connect/auth',
      clientId: 'webmock-web',
      redirectUri: 'https://webmock.localhost:8443/',
      acrValues: '2se',
      state: 'state-1',
      nonce: 'nonce-1'
    })

    expect(url).toContain('acr_values=2se')
    expect(url).toContain('client_id=webmock-web')
  })

  it('treats 2se as satisfying 1se endpoints', () => {
    expect(satisfiesAssuranceLevel('2se', '1se')).toBe(true)
    expect(satisfiesAssuranceLevel('1se', '2se')).toBe(false)
  })

  it('describes API access based on current acr', () => {
    expect(getServiceMockApiAccessLabel('2se')).toContain('1se als auch 2se')
    expect(getServiceMockApiAccessLabel('1se')).toContain('nur 1se')
  })
})

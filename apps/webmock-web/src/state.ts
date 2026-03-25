import type { ServiceMockApiAssuranceLevel } from '@auth-sandbox-2/shared-types'

export function buildAuthorizationUrl(input: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  acrValues: string
  state: string
  nonce: string
  loginHint?: string | null
}) {
  const url = new URL(input.authorizationEndpoint)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile email servicemock-api-access')
  url.searchParams.set('acr_values', input.acrValues)
  url.searchParams.set('state', input.state)
  url.searchParams.set('nonce', input.nonce)
  if (input.loginHint) {
    url.searchParams.set('login_hint', input.loginHint)
  }
  return url.toString()
}

export function normalizeAcr(acr: unknown) {
  return typeof acr === 'string' && acr.trim() ? acr : null
}

export function normalizeAmr(amr: unknown) {
  if (Array.isArray(amr)) {
    return amr.filter((value): value is string => typeof value === 'string')
  }
  if (typeof amr === 'string') {
    return amr.split(' ').filter(Boolean)
  }
  return []
}

export function satisfiesAssuranceLevel(acr: string | null, requiredLevel: ServiceMockApiAssuranceLevel) {
  if (requiredLevel === '1se') {
    return acr === '1se' || acr === '2se'
  }
  return acr === '2se'
}

export function getServiceMockApiAccessLabel(acr: string | null) {
  if (acr === '2se') {
    return 'Mit 2se darfst du sowohl 1se als auch 2se Endpunkte aufrufen.'
  }
  if (acr === '1se') {
    return 'Mit 1se darfst du nur 1se Endpunkte aufrufen.'
  }
  return 'Noch keine Sitzung vorhanden.'
}

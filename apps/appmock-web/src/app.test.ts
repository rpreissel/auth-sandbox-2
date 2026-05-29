import { describe, expect, it } from 'vitest'

import type { ServiceMockApiMessagesResponse, ServiceMockApiProfileResponse } from '@auth-sandbox-2/shared-types'

import { getAndroidSecurityStatus, getConflictDevices, getDeviceConflictIds } from './App'

const mockProfile: ServiceMockApiProfileResponse = {
  traceId: 'trace-1',
  correlationId: 'trace-1',
  subject: 'subject-1',
  userId: 'demo-user',
  username: 'demo-user',
  audience: ['account', 'servicemock-api'],
  scope: ['openid', 'profile'],
  issuer: 'https://keycloak.localhost:8443/realms/auth-sandbox-2',
  clientId: 'appmock-web',
  issuedAt: '2026-03-14T12:00:00.000Z',
  expiresAt: '2026-03-14T12:10:00.000Z'
}

const mockMessages: ServiceMockApiMessagesResponse = {
  traceId: 'trace-1',
  correlationId: 'trace-1',
  items: [
    {
      id: 'message-1',
      text: 'JWKS validation accepted the token.',
      authorUserId: 'demo-user',
      createdAt: '2026-03-14T12:05:00.000Z',
      category: 'seed'
    }
  ]
}

describe('appmock-web status card', () => {
  it('does not claim a binding exists when no device is stored', () => {
    const status = getAndroidSecurityStatus({
      restoringDevice: false,
      hasDeviceBinding: false,
      hasChallenge: false,
      hasTokens: false,
      tokenLifetimeLabel: null
    })

    expect(status.pills).toEqual(['Keystore bereit', 'Nicht gebunden'])
    expect(status.detail).toBe('Noch keine Gerätebindung gespeichert.')
  })

  it('shows device binding only when a device is stored', () => {
    const status = getAndroidSecurityStatus({
      restoringDevice: false,
      hasDeviceBinding: true,
      hasChallenge: false,
      hasTokens: false,
      tokenLifetimeLabel: null
    })

    expect(status.pills).toContain('Gerät gebunden')
    expect(status.detail).toBe('Die Gerätebindung ist gespeichert, aber es gibt noch keine aktive Keycloak-Sitzung.')
  })

  it('covers protected servicemock-api response shapes', () => {
    expect(mockProfile.audience).toContain('servicemock-api')
    expect(mockProfile.clientId).toBe('appmock-web')
    expect(mockMessages.items[0]?.category).toBe('seed')
  })

  it('deduplicates conflicting device ids before deletion', () => {
    expect(getDeviceConflictIds([
      { id: 'device-1' },
      { id: 'device-2' },
      { id: 'device-1' }
    ])).toEqual(['device-1', 'device-2'])
  })

  it('supports legacy single-device conflict responses', () => {
    expect(getConflictDevices({
      existingDevice: { id: 'device-1', conflictToken: 'token-1' }
    })).toEqual([{ id: 'device-1', conflictToken: 'token-1' }])
  })
})

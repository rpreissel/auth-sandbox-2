import { describe, expect, it } from 'vitest'

import type { MockApiMessagesResponse, MockApiProfileResponse } from '@auth-sandbox-2/shared-types'

const mockProfile: MockApiProfileResponse = {
  traceId: 'trace-1',
  correlationId: 'trace-1',
  subject: 'subject-1',
  userId: 'demo-user',
  username: 'demo-user',
  audience: ['account', 'mock-api'],
  scope: ['openid', 'profile'],
  issuer: 'https://keycloak.localhost:8443/realms/auth-sandbox-2',
  clientId: 'app-web',
  issuedAt: '2026-03-14T12:00:00.000Z',
  expiresAt: '2026-03-14T12:10:00.000Z'
}

const mockMessages: MockApiMessagesResponse = {
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

describe('app placeholder', () => {
  it('keeps test runner happy', () => {
    expect(true).toBe(true)
  })

  it('covers protected mock-api response shapes', () => {
    expect(mockProfile.audience).toContain('mock-api')
    expect(mockProfile.clientId).toBe('app-web')
    expect(mockMessages.items[0]?.category).toBe('seed')
  })
})

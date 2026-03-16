import { describe, expect, it, vi } from 'vitest'

import { createFlowToken, createServiceResultToken, createServiceToken, verifyFlowToken, verifyServiceResultToken, verifyServiceToken } from './flow-tokens.js'

describe('flow tokens', () => {
  it('round-trips a valid token', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const token = createFlowToken('flow-123', expiresAt)

    expect(verifyFlowToken(token, 'flow-123')).toEqual({
      ok: true,
      claims: {
        kind: 'flow',
        flowId: 'flow-123',
        expiresAt
      }
    })
  })

  it('rejects a token for a different flow', () => {
    const token = createFlowToken('flow-123', new Date(Date.now() + 60_000).toISOString())

    expect(verifyFlowToken(token, 'flow-456')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects an expired token', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))

    const token = createFlowToken('flow-123', '2026-03-15T11:59:59.000Z')

    expect(verifyFlowToken(token, 'flow-123')).toEqual({ ok: false, reason: 'expired' })

    vi.useRealTimers()
  })

  it('rejects a tampered token', () => {
    const token = createFlowToken('flow-123', new Date(Date.now() + 60_000).toISOString())
    const [payload] = token.split('.')

    expect(verifyFlowToken(`${payload}.tampered`, 'flow-123')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('falls back to env secret when backend-core config is stale in tests', () => {
    process.env.AUTH_API_FLOW_TOKEN_SECRET = 'fallback-flow-token-secret'
    const token = createFlowToken('flow-789', new Date(Date.now() + 60_000).toISOString())

    expect(verifyFlowToken(token, 'flow-789').ok).toBe(true)
  })

  it('round-trips a valid service token', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const token = createServiceToken('flow-123', 'sms_tan', 'svc-1', expiresAt)

    expect(verifyServiceToken(token, 'sms_tan')).toEqual({
      ok: true,
      claims: {
        kind: 'service',
        flowId: 'flow-123',
        service: 'sms_tan',
        serviceSessionId: 'svc-1',
        expiresAt
      }
    })
  })

  it('round-trips a valid service result token', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const token = createServiceResultToken('flow-123', 'person_code', 'svc-2', 'level_2', expiresAt)

    expect(verifyServiceResultToken(token, 'flow-123')).toEqual({
      ok: true,
      claims: {
        kind: 'service_result',
        flowId: 'flow-123',
        service: 'person_code',
        serviceSessionId: 'svc-2',
        achievedAcr: 'level_2',
        expiresAt
      }
    })
  })
})

import { describe, expect, it, vi } from 'vitest'

import { createFlowToken, verifyFlowToken } from './flow-tokens.js'

describe('flow tokens', () => {
  it('round-trips a valid token', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const token = createFlowToken('flow-123', expiresAt)

    expect(verifyFlowToken(token, 'flow-123')).toEqual({
      ok: true,
      claims: {
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
})

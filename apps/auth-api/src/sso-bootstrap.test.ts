import { createHmac } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  buildSsoBootstrapTargetUrl,
  createSsoBootstrapState,
  getSsoBootstrapTarget,
  normalizeSsoBootstrapTargetPath,
  type SsoBootstrapStateClaims,
  verifySsoBootstrapState
} from './sso-bootstrap.js'

function signTestState(claims: SsoBootstrapStateClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const secret = process.env.AUTH_API_SSO_STATE_SECRET ?? 'change-me-sso-state-secret'
  const signature = createHmac('sha256', secret).update(payload).digest().toString('base64url')
  return `${payload}.${signature}`
}

describe('sso bootstrap state', () => {
  it('creates and verifies a valid signed state', () => {
    const token = createSsoBootstrapState({
      targetId: 'webmock',
      targetPath: '/notes?tab=recent',
      requestedAcr: '2se'
    })

    expect(verifySsoBootstrapState(token)).toEqual({
      ok: true,
      claims: expect.objectContaining({
        kind: 'sso_bootstrap',
        targetId: 'webmock',
        targetClientId: 'webmock-web',
        targetPath: '/notes?tab=recent',
        requestedAcr: '2se'
      })
    })
  })

  it('rejects expired signed state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-31T12:00:00.000Z'))

    const token = createSsoBootstrapState({
      targetId: 'webmock',
      targetPath: '/',
      requestedAcr: '1se'
    })

    vi.setSystemTime(new Date('2026-03-31T12:06:00.000Z'))
    expect(verifySsoBootstrapState(token)).toEqual({ ok: false, reason: 'expired' })

    vi.useRealTimers()
  })

  it('rejects tampered state', () => {
    const token = createSsoBootstrapState({
      targetId: 'webmock',
      targetPath: '/',
      requestedAcr: '1se'
    })
    const [payload] = token.split('.')

    expect(verifySsoBootstrapState(`${payload}.tampered`)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects signed state with a mismatched allowlisted client id', () => {
    const token = signTestState({
      kind: 'sso_bootstrap',
      jti: '4a1f3f2c-6c7f-4c2a-a4c3-f9cfdb79aa10',
      targetId: 'webmock',
      targetClientId: 'appmock-web',
      targetPath: '/',
      requestedAcr: '1se',
      exp: Math.floor(Date.now() / 1000) + 300
    })

    expect(verifySsoBootstrapState(token)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects signed state with a non-normalized target path', () => {
    const token = signTestState({
      kind: 'sso_bootstrap',
      jti: '3db1b5b6-40bd-44dd-a697-60702c0149b4',
      targetId: 'webmock',
      targetClientId: 'webmock-web',
      targetPath: '',
      requestedAcr: '2se',
      exp: Math.floor(Date.now() / 1000) + 300
    })

    expect(verifySsoBootstrapState(token)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects signed state with an invalid jti', () => {
    const token = signTestState({
      kind: 'sso_bootstrap',
      jti: 'not-a-jti',
      targetId: 'webmock',
      targetClientId: 'webmock-web',
      targetPath: '/',
      requestedAcr: '2se',
      exp: Math.floor(Date.now() / 1000) + 300
    })

    expect(verifySsoBootstrapState(token)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('normalizes empty path to root', () => {
    expect(normalizeSsoBootstrapTargetPath(undefined)).toBe('/')
    expect(normalizeSsoBootstrapTargetPath('')).toBe('/')
  })

  it('rejects relative target paths without a leading slash', () => {
    expect(() => normalizeSsoBootstrapTargetPath('notes')).toThrow('Bootstrap target path must start with /')
  })

  it('builds a same-origin allowlisted target url', () => {
    const target = getSsoBootstrapTarget('webmock')
    expect(buildSsoBootstrapTargetUrl(target, '/notes?tab=recent')).toBe('https://webmock.localhost:8443/notes?tab=recent')
  })

  it('rejects paths that escape the allowlisted origin', () => {
    const target = getSsoBootstrapTarget('webmock')
    expect(() => buildSsoBootstrapTargetUrl(target, 'https://evil.example/test')).toThrow('Bootstrap target path must start with /')
  })
})

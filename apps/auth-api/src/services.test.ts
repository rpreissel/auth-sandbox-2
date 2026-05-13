import { describe, expect, it } from 'vitest'

import { hashPublicKey } from './lib/crypto.js'
import { createDeviceHandoverProof, deriveUserDeviceHandoverSecret } from './device-handover.js'

describe('hashPublicKey', () => {
  it('is deterministic', () => {
    expect(hashPublicKey('test-key')).toBe(hashPublicKey('test-key'))
  })
})

describe('device handover proof', () => {
  it('derives a stable per-user secret and proof', () => {
    const secret = deriveUserDeviceHandoverSecret('demo-user')
    expect(secret).toBe(deriveUserDeviceHandoverSecret('demo-user'))
    expect(secret).not.toBe(deriveUserDeviceHandoverSecret('other-user'))

    expect(createDeviceHandoverProof({
      userHandoverSecret: secret,
      userId: 'demo-user',
      publicKeyHash: 'hash-1',
      nonce: 'nonce-1',
      exp: 123,
      jti: '00000000-0000-0000-0000-000000000001',
      acr: '2se'
    })).toBe(createDeviceHandoverProof({
      userHandoverSecret: secret,
      userId: 'demo-user',
      publicKeyHash: 'hash-1',
      nonce: 'nonce-1',
      exp: 123,
      jti: '00000000-0000-0000-0000-000000000001',
      acr: '2se'
    }))
  })
})

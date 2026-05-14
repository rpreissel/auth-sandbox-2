import { createDecipheriv } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { hashPublicKey } from './lib/crypto.js'
import { createHandoverEnvelope, generateHandoverSecret } from './device-handover.js'

describe('hashPublicKey', () => {
  it('is deterministic', () => {
    expect(hashPublicKey('test-key')).toBe(hashPublicKey('test-key'))
  })
})

describe('handover envelope', () => {
  it('generates a random secret', () => {
    const secret1 = generateHandoverSecret()
    const secret2 = generateHandoverSecret()
    expect(secret1).not.toBe(secret2)
    expect(secret1.length).toBe(43)
  })

  it('produces distinct IVs per call', () => {
    const secret = generateHandoverSecret()
    const env1 = createHandoverEnvelope({
      userHandoverSecret: secret,
      userId: 'demo-user',
      publicKeyHash: 'hash-1',
      nonce: 'nonce-1',
      exp: 123,
      jti: '00000000-0000-0000-0000-000000000001',
      acr: '2se'
    })
    const env2 = createHandoverEnvelope({
      userHandoverSecret: secret,
      userId: 'demo-user',
      publicKeyHash: 'hash-1',
      nonce: 'nonce-1',
      exp: 123,
      jti: '00000000-0000-0000-0000-000000000001',
      acr: '2se'
    })
    expect(env1.handoverIv).not.toBe(env2.handoverIv)
    expect(env1.handoverCiphertext).not.toBe(env2.handoverCiphertext)
  })

  it('round-trips inner payload correctly', () => {
    const secret = generateHandoverSecret()
    const { handoverIv, handoverCiphertext } = createHandoverEnvelope({
      userHandoverSecret: secret,
      userId: 'demo-user',
      publicKeyHash: 'hash-1',
      nonce: 'nonce-1',
      exp: 123,
      jti: '00000000-0000-0000-0000-000000000001',
      acr: '2se'
    })
    const secretBytes = Buffer.from(secret, 'base64url')
    const source = Buffer.from(handoverCiphertext, 'base64url')
    const authTag = source.subarray(source.length - 16)
    const ciphertext = source.subarray(0, source.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', secretBytes, Buffer.from(handoverIv, 'base64url'))
    decipher.setAuthTag(authTag)
    const inner = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
    expect(inner.type).toBe('device')
    expect(inner.sub).toBe('demo-user')
    expect(inner.publicKeyHash).toBe('hash-1')
    expect(inner.nonce).toBe('nonce-1')
    expect(inner.exp).toBe(123)
    expect(inner.jti).toBe('00000000-0000-0000-0000-000000000001')
    expect(inner.acr).toBe('2se')
  })

  it('fails auth tag if ciphertext is tampered', () => {
    const secret = generateHandoverSecret()
    const { handoverIv, handoverCiphertext } = createHandoverEnvelope({
      userHandoverSecret: secret,
      userId: 'demo-user',
      publicKeyHash: 'hash-1',
      nonce: 'nonce-1',
      exp: 123,
      jti: '00000000-0000-0000-0000-000000000001',
      acr: null
    })
    const tampered = Buffer.from(handoverCiphertext, 'base64url')
    tampered[tampered.length - 17] ^= 0xff
    const secretBytes = Buffer.from(secret, 'base64url')
    const source = Buffer.concat([tampered.subarray(0, tampered.length - 16), tampered.subarray(tampered.length - 16)])
    expect(() => {
      const decipher = createDecipheriv('aes-256-gcm', secretBytes, Buffer.from(handoverIv, 'base64url'))
      decipher.setAuthTag(source.subarray(source.length - 16))
      decipher.update(source.subarray(0, source.length - 16))
      decipher.final()
    }).toThrow()
  })
})
import { describe, expect, it } from 'vitest'

import { hashPublicKey } from './lib/crypto.js'

describe('hashPublicKey', () => {
  it('is deterministic', () => {
    expect(hashPublicKey('test-key')).toBe(hashPublicKey('test-key'))
  })
})

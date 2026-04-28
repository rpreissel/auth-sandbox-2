import { describe, expect, it, vi } from 'vitest'

import { fetchSourceUser } from './keycloak.js'

const originalFetch = globalThis.fetch

describe('fetchSourceUser', () => {
  it('returns null when the source user does not exist', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => []
      })

    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchSourceUser('missing-user')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
    globalThis.fetch = originalFetch
  })
})

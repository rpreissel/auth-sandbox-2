import { describe, expect, it, vi } from 'vitest'

import { pool } from '@auth-sandbox-2/backend-core'

import { fetchSourceIdentity } from './keycloak.js'

describe('fetchSourceIdentity', () => {
  it('returns null when the source registration identity does not exist', async () => {
    const queryMock = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as never)

    await expect(fetchSourceIdentity('missing-user')).resolves.toBeNull()
    expect(queryMock).toHaveBeenCalledTimes(1)

    queryMock.mockRestore()
  })
})

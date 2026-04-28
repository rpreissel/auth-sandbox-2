import { describe, expect, it } from 'vitest'

import type { DeviceRecord, RegistrationIdentityRecord, TanMockAdminRecord } from '@auth-sandbox-2/shared-types'

import { TRACE_VIEWER_ENTRY, TRACE_VIEWER_URL, filterDevices, filterRegistrationIdentities, filterTanEntries, parseApiErrorMessage } from './main'

const devices: DeviceRecord[] = [
  {
    id: 'device-1',
    userId: 'demo-user',
    deviceName: 'Pixel 8',
    publicKeyHash: 'HASH-ABC',
    active: true,
    createdAt: '2026-03-18T12:00:00.000Z'
  }
]

const identities: RegistrationIdentityRecord[] = [
  {
    id: 'identity-1',
    userId: 'demo-user',
    firstName: 'Demo',
    lastName: 'User',
    birthDate: '1990-01-01',
    code: 'A1B2C3D4',
    codeExpiresAt: '2026-04-01T00:00:00.000Z',
    codeUseCount: 0,
    phoneNumber: '+491701234567',
    createdAt: '2026-03-18T12:00:00.000Z',
    updatedAt: '2026-03-18T12:00:00.000Z'
  }
]

const tanEntries: TanMockAdminRecord[] = [
  {
    id: 'tan-1',
    tan: '471199',
    userId: 'demo-user',
    sourceUserId: 'tanmock-admin',
    active: true,
    consumedAt: null,
    createdAt: '2026-03-18T12:00:00.000Z'
  }
]

describe('admin overview helpers', () => {
  it('exposes a dedicated Trace Viewer entry', () => {
    expect(TRACE_VIEWER_URL).toBe('https://trace.localhost:8443/')
    expect(TRACE_VIEWER_ENTRY.href).toBe(TRACE_VIEWER_URL)
    expect(TRACE_VIEWER_ENTRY.title).toMatch(/Trace Viewer/i)
    expect(TRACE_VIEWER_ENTRY.highlights).toContain('Detailinspektion pro Trace')
  })

  it('filters devices case-insensitively across overview fields', () => {
    expect(filterDevices(devices, 'pixel')).toHaveLength(1)
    expect(filterDevices(devices, 'hash-abc')).toHaveLength(1)
    expect(filterDevices(devices, 'unknown')).toHaveLength(0)
  })

  it('filters registration identities across code and phone metadata', () => {
    expect(filterRegistrationIdentities(identities, 'a1b2')).toHaveLength(1)
    expect(filterRegistrationIdentities(identities, '+49170')).toHaveLength(1)
    expect(filterRegistrationIdentities(identities, 'missing')).toHaveLength(0)
  })

  it('filters tan entries across user, source user, and tan fields', () => {
    expect(filterTanEntries(tanEntries, 'demo')).toHaveLength(1)
    expect(filterTanEntries(tanEntries, '4711')).toHaveLength(1)
    expect(filterTanEntries(tanEntries, 'missing')).toHaveLength(0)
  })

  it('extracts structured API error messages for the admin form', () => {
    expect(parseApiErrorMessage('{"statusCode":500,"message":"duplicate key value violates unique constraint"}')).toBe(
      'duplicate key value violates unique constraint'
    )
    expect(parseApiErrorMessage('plain text failure')).toBe('plain text failure')
  })
})

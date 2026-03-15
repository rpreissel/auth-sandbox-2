import { describe, expect, it } from 'vitest'

import {
  assertAssuranceFlowTransition,
  canTransitionAssuranceFlowStatus,
  isTerminalAssuranceFlowStatus,
  mapAssuranceFlowRecord
} from './assurance-flows.js'

describe('assurance flow status transitions', () => {
  it('allows the expected happy path transitions', () => {
    expect(canTransitionAssuranceFlowStatus('started', 'method_in_progress')).toBe(true)
    expect(canTransitionAssuranceFlowStatus('method_in_progress', 'method_verified')).toBe(true)
    expect(canTransitionAssuranceFlowStatus('method_verified', 'finalizable')).toBe(true)
    expect(canTransitionAssuranceFlowStatus('finalizable', 'finalized')).toBe(true)
  })

  it('allows direct transition from method_in_progress to finalizable', () => {
    expect(canTransitionAssuranceFlowStatus('method_in_progress', 'finalizable')).toBe(true)
  })

  it('rejects invalid transitions', () => {
    expect(canTransitionAssuranceFlowStatus('started', 'finalized')).toBe(false)
    expect(canTransitionAssuranceFlowStatus('finalized', 'method_in_progress')).toBe(false)
    expect(canTransitionAssuranceFlowStatus('expired', 'started')).toBe(false)
    expect(() => assertAssuranceFlowTransition('finalized', 'failed')).toThrow(
      'Invalid assurance flow status transition: finalized -> failed'
    )
  })

  it('treats same-status updates as idempotent', () => {
    expect(canTransitionAssuranceFlowStatus('finalized', 'finalized')).toBe(true)
    expect(canTransitionAssuranceFlowStatus('failed', 'failed')).toBe(true)
  })

  it('marks finalized, failed, and expired as terminal', () => {
    expect(isTerminalAssuranceFlowStatus('finalized')).toBe(true)
    expect(isTerminalAssuranceFlowStatus('failed')).toBe(true)
    expect(isTerminalAssuranceFlowStatus('expired')).toBe(true)
    expect(isTerminalAssuranceFlowStatus('finalizable')).toBe(false)
  })

  it('maps method, next action, and finalization for public records', () => {
    const record = mapAssuranceFlowRecord({
      id: 'flow-1',
      purpose: 'step_up',
      status: 'finalized',
      current_method: 'sms',
      requested_acr: 'urn:auth-sandbox-2:acr:sms',
      target_assurance: null,
      device_id: null,
      user_hint: 'demo-user',
      prospective_user_id: 'demo-user',
      resolved_user_id: 'demo-user',
      challenge_binding_json: {},
      context_json: {},
      method_state_json: {
        method: 'sms',
        state: 'challenge_verified',
        maskedTarget: '+49******123',
        code: '123456'
      },
      result_json: {
        assurance: ['phone_verified'],
        achievedAcr: 'urn:auth-sandbox-2:acr:sms',
        amr: ['sms']
      },
      idempotency_key: null,
      finalize_lock_version: 1,
      finalize_locked_at: null,
      final_artifact_kind: 'assurance_handle',
      final_artifact_code: 'ah_123',
      final_artifact_expires_at: '2026-03-15T12:00:00.000Z',
      final_artifact_consumed_at: null,
      expires_at: '2026-03-15T12:00:00.000Z',
      finalized_at: '2026-03-15T11:59:00.000Z',
      created_at: '2026-03-15T11:50:00.000Z',
      updated_at: '2026-03-15T11:59:00.000Z'
    })

    expect(record.nextAction).toBeNull()
    expect(record.method?.kind).toBe('sms')
    expect(record.method?.devCode).toBe('123456')
    expect(record.result?.assurance).toEqual(['phone_verified'])
    expect(record.finalization).toEqual({
      kind: 'assurance_handle',
      assuranceHandle: 'ah_123',
      expiresAt: '2026-03-15T12:00:00.000Z'
    })
  })
})

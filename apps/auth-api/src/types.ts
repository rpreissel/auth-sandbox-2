export type RegistrationCodeRow = {
  id: string
  user_id: string
  display_name: string | null
  code: string
  expires_at: string
  use_count: number
  created_at: string
}

export type DeviceRow = {
  id: string
  user_id: string
  device_name: string
  public_key: string
  public_key_hash: string
  enc_pub_key: string
  keycloak_user_id: string
  keycloak_credential_id: string | null
  active: boolean
  created_at: string
}

export type ChallengeRow = {
  id: string
  nonce: string
  user_id: string
  device_id: string
  public_key_hash: string
  expires_at: string
  used: boolean
  created_at: string
}

export const assuranceFlowPurposes = ['registration', 'account_upgrade', 'step_up'] as const

export type AssuranceFlowPurpose = (typeof assuranceFlowPurposes)[number]

export const assuranceFlowStatuses = [
  'started',
  'method_in_progress',
  'method_verified',
  'finalizable',
  'finalized',
  'failed',
  'expired'
] as const

export type AssuranceFlowStatus = (typeof assuranceFlowStatuses)[number]

export type AssuranceFlowJson = Record<string, unknown>

export type AssuranceFlowRow = {
  id: string
  purpose: AssuranceFlowPurpose
  status: AssuranceFlowStatus
  current_method: string | null
  requested_acr: string | null
  target_assurance: string | null
  device_id: string | null
  user_hint: string | null
  prospective_user_id: string | null
  resolved_user_id: string | null
  challenge_binding_json: AssuranceFlowJson
  context_json: AssuranceFlowJson
  method_state_json: AssuranceFlowJson
  result_json: AssuranceFlowJson
  idempotency_key: string | null
  finalize_lock_version: number
  finalize_locked_at: string | null
  final_artifact_kind: string | null
  final_artifact_code: string | null
  final_artifact_expires_at: string | null
  final_artifact_consumed_at: string | null
  expires_at: string
  finalized_at: string | null
  created_at: string
  updated_at: string
}

export type AssuranceFlowEventRow = {
  id: string
  flow_id: string
  event_type: string
  payload_json: AssuranceFlowJson
  created_at: string
}

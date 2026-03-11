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

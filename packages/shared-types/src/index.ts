export type IsoDateTime = string

export type RegistrationCodeRecord = {
  id: string
  userId: string
  displayName: string | null
  code: string
  expiresAt: IsoDateTime
  useCount: number
  createdAt: IsoDateTime
}

export type DeviceRecord = {
  id: string
  userId: string
  deviceName: string
  publicKeyHash: string
  active: boolean
  createdAt: IsoDateTime
}

export type CreateRegistrationCodeInput = {
  userId: string
  displayName?: string
  validForDays?: number
}

export type RegisterDeviceInput = {
  userId: string
  deviceName: string
  activationCode: string
  publicKey: string
}

export type RegisterDeviceResponse = {
  deviceId: string
  deviceName: string
  publicKeyHash: string
  passwordRequired: boolean
}

export type SetPasswordInput = {
  userId: string
  password: string
}

export type StartLoginInput = {
  publicKeyHash: string
}

export type StartLoginResponse = {
  nonce: string
  encryptedKey: string
  encryptedData: string
  iv: string
  expiresAt: IsoDateTime
}

export type FinishLoginInput = {
  nonce: string
  encryptedKey: string
  encryptedData: string
  iv: string
  signature: string
}

export type RefreshTokensInput = {
  refreshToken: string
}

export type LogoutInput = {
  refreshToken: string
}

export type JwtClaims = Record<string, boolean | number | string | string[] | null | undefined>

export type TokenBundle = {
  accessToken: string
  idToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  scope: string
  accessTokenClaims: JwtClaims
  idTokenClaims: JwtClaims
}

export type FinishLoginResponse = TokenBundle & {
  requiredAction: string | null
}

export type RefreshTokensResponse = TokenBundle

export type LogoutResponse = {
  logout: true
}

export type HealthResponse = {
  status: 'ok'
  service: string
}

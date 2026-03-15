import { randomUUID } from 'node:crypto'

import { appConfig, logger, pool, recordArtifact, runWithSpan, withTransaction } from '@auth-sandbox-2/backend-core'
import type {
  CreateFlowInput,
  CreateRegistrationCodeInput,
  DeviceRecord,
  FinishLoginInput,
  FinishLoginResponse,
  LogoutResponse,
  RefreshTokensInput,
  RefreshTokensResponse,
  RegisterDeviceInput,
  RegisterDeviceResponse,
  RegistrationCodeRecord,
  SetPasswordInput,
  StartLoginInput,
  StartLoginResponse
} from '@auth-sandbox-2/shared-types'

import {
  completePublicAssuranceFlowMethod,
  createPublicAssuranceFlow,
  finalizePublicAssuranceFlow,
  registerDeviceViaFlow,
  startPublicAssuranceFlowMethod
} from './assurance-flows.js'
import { createEncryptedChallenge, generateEncryptionKeyPair, hashPublicKey } from './lib/crypto.js'
import { generateActivationCode } from './lib/password.js'
import { KeycloakAdminClient, KeycloakAuthClient } from './keycloak.js'
import type { ChallengeRow, DeviceRow, RegistrationCodeRow } from './types.js'

const adminClient = new KeycloakAdminClient()
const authClient = new KeycloakAuthClient()

function notFound(message: string) {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = 404
  return error
}

function mapRegistrationCode(row: RegistrationCodeRow): RegistrationCodeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    code: row.code,
    expiresAt: row.expires_at,
    useCount: row.use_count,
    createdAt: row.created_at
  }
}

function mapDevice(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    deviceName: row.device_name,
    publicKeyHash: row.public_key_hash,
    active: row.active,
    createdAt: row.created_at
  }
}

export async function listRegistrationCodes() {
  const result = await pool.query<RegistrationCodeRow>('select * from registration_codes order by created_at desc')
  return result.rows.map(mapRegistrationCode)
}

export async function createRegistrationCode(input: CreateRegistrationCodeInput) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'create_registration_code',
      userId: input.userId,
      notes: 'Create registration code service operation.'
    },
    async () => {
      await adminClient.ensureUser(input.userId, input.displayName)
      const code = generateActivationCode()
      const validForDays = input.validForDays ?? 90
      const result = await pool.query<RegistrationCodeRow>(
        `insert into registration_codes (user_id, display_name, code, expires_at)
         values ($1, $2, $3, now() + ($4 || ' days')::interval)
         returning *`,
        [input.userId, input.displayName ?? null, code, validForDays]
      )
      return mapRegistrationCode(result.rows[0])
    }
  )
}

export async function deleteRegistrationCode(id: string) {
  await pool.query('delete from registration_codes where id = $1', [id])
}

export async function listDevices() {
  const result = await pool.query<DeviceRow>('select * from devices order by created_at desc')
  return result.rows.map(mapDevice)
}

export async function deleteDevice(id: string) {
  await runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'delete_device',
      notes: 'Delete device service operation.'
    },
    async () => {
      const result = await pool.query<DeviceRow>('delete from devices where id = $1 returning *', [id])
      const device = result.rows[0]
      if (device?.keycloak_credential_id) {
        await adminClient.deleteDeviceCredential(device.user_id, device.keycloak_credential_id)
      }
    }
  )
}

export async function registerDevice(input: RegisterDeviceInput): Promise<RegisterDeviceResponse> {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'register_device',
      userId: input.userId,
      notes: 'Register device service operation.'
    },
    async () => registerDeviceViaFlow(input)
  )
}

export async function setPassword(input: SetPasswordInput) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'set_password',
      userId: input.userId,
      notes: 'Set password service operation.'
    },
    async () => {
      await adminClient.setPassword(input.userId, input.password)
      return { passwordSet: true as const }
    }
  )
}

export async function startLogin(input: StartLoginInput): Promise<StartLoginResponse> {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'start_login',
      notes: 'Start device login service operation.'
    },
    async (spanId) => {
      const result = await pool.query<DeviceRow>('select * from devices where public_key_hash = $1 and active = true', [input.publicKeyHash])
      const device = result.rows[0]
      if (!device) {
        throw notFound('Unknown device')
      }

      const nonce = randomUUID()
      const expiresAt = new Date(Date.now() + appConfig.challengeTtlSeconds * 1000)
      const challengePayload = {
        userId: device.user_id,
        nonce,
        exp: Math.floor(expiresAt.getTime() / 1000),
        deviceId: device.id
      }
      const challenge = createEncryptedChallenge(challengePayload, device.enc_pub_key)

      await recordArtifact({
        spanId,
        artifactType: 'encrypted_blob',
        name: 'encrypted_challenge',
        contentType: 'application/json',
        encoding: 'json',
        direction: 'internal',
        rawValue: JSON.stringify({
          encryptedKey: challenge.encryptedKey,
          encryptedData: challenge.encryptedData,
          iv: challenge.iv,
          exp: challengePayload.exp,
          nonce,
          decrypted: challengePayload
        }, null, 2),
        explanation: 'Encrypted challenge stored with decrypted payload for demo inspection.'
      })

      await pool.query(
        `insert into login_challenges (nonce, user_id, device_id, public_key_hash, expires_at, used)
         values ($1, $2, $3, $4, $5, false)`,
        [nonce, device.user_id, device.id, device.public_key_hash, expiresAt.toISOString()]
      )

      return {
        nonce,
        encryptedKey: challenge.encryptedKey,
        encryptedData: challenge.encryptedData,
        iv: challenge.iv,
        expiresAt: expiresAt.toISOString()
      }
    }
  )
}

export async function finishLogin(input: FinishLoginInput): Promise<FinishLoginResponse> {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'finish_login',
      challengeId: input.nonce,
      notes: 'Finish device login service operation.'
    },
    async (spanId) => {
      const challengeResult = await pool.query<ChallengeRow>('select * from login_challenges where nonce = $1', [input.nonce])
      const challenge = challengeResult.rows[0]
      if (!challenge) {
        throw new Error('Unknown challenge')
      }
      if (challenge.used) {
        throw new Error('Challenge already used')
      }
      if (new Date(challenge.expires_at).getTime() < Date.now()) {
        throw new Error('Challenge expired')
      }

      await pool.query('update login_challenges set used = true where id = $1', [challenge.id])
      const loginTokenPayload = {
        type: 'device',
        sub: challenge.user_id,
        publicKeyHash: challenge.public_key_hash,
        nonce: challenge.nonce,
        encryptedKey: input.encryptedKey,
        encryptedData: input.encryptedData,
        iv: input.iv,
        signature: input.signature
      }
      const loginToken = Buffer.from(JSON.stringify(loginTokenPayload)).toString('base64url')
      await recordArtifact({
        spanId,
        artifactType: 'jwt',
        name: 'login_token_payload',
        contentType: 'application/jwt',
        encoding: 'base64url',
        direction: 'outbound',
        rawValue: loginToken,
        explanation: 'Base64URL-encoded login token payload forwarded into Keycloak device authentication.'
      })
      const tokens = await authClient.authenticate(loginToken)
      return {
        ...tokens,
        requiredAction: null
      }
    }
  )
}

export async function refreshTokens(input: RefreshTokensInput): Promise<RefreshTokensResponse> {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'refresh_tokens',
      notes: 'Refresh token service operation.'
    },
    async () => authClient.refresh(input.refreshToken)
  )
}

export async function logout(input: RefreshTokensInput): Promise<LogoutResponse> {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'logout',
      notes: 'Logout service operation.'
    },
    async () => {
      await authClient.logout(input.refreshToken)
      return { logout: true }
    }
  )
}

export async function startBrowserStepUpFlow(input: {
  userId: string
  phoneNumber: string
  requestedAcr?: string
}) {
  const created = await createPublicAssuranceFlow({
    purpose: 'step_up',
    userHint: input.userId,
    prospectiveUserId: input.userId,
    requestedAcr: input.requestedAcr ?? 'urn:auth-sandbox-2:acr:sms',
    context: {
      phoneNumber: input.phoneNumber
    }
  } satisfies CreateFlowInput)
  await startPublicAssuranceFlowMethod(created.flowId, 'sms', {
    payload: {
      target: input.phoneNumber
    }
  })
  const started = await completePublicAssuranceFlowMethod(created.flowId, 'sms', {
    payload: {
      code: created.method?.devCode ?? '000000'
    }
  })
  return finalizePublicAssuranceFlow(started.flowId, 'browser')
}

export async function completeMobileStepUp(input: {
  userId: string
  phoneNumber: string
  refreshToken?: string
}) {
  const created = await createPublicAssuranceFlow({
    purpose: 'step_up',
    userHint: input.userId,
    prospectiveUserId: input.userId,
    requestedAcr: 'urn:auth-sandbox-2:acr:sms',
    context: {
      phoneNumber: input.phoneNumber
    }
  })
  const started = await startPublicAssuranceFlowMethod(created.flowId, 'sms', {
    payload: {
      target: input.phoneNumber
    }
  })
  const completed = await completePublicAssuranceFlowMethod(started.flowId, 'sms', {
    payload: {
      code: started.method?.devCode ?? '000000'
    }
  })
  const finalized = await finalizePublicAssuranceFlow(completed.flowId, 'mobile')
  if (!finalized.finalization || finalized.finalization.kind !== 'assurance_handle') {
    throw new Error('Mobile step-up flow did not yield an assurance handle')
  }
  const tokens = await authClient.authenticateWithAssuranceHandle(finalized.finalization.assuranceHandle, input.refreshToken)
  return {
    flow: finalized,
    tokens
  }
}

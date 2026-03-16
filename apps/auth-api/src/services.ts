import { randomUUID } from 'node:crypto'

import { appConfig, logger, pool, recordArtifact, runWithSpan, withTransaction } from '@auth-sandbox-2/backend-core'
import type {
  AssuranceFlowService,
  CreateFlowInput,
  CreateRegistrationIdentityInput,
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
  RegistrationPersonCodeRecord,
  RegistrationPersonRecord,
  RegistrationPersonSmsNumberRecord,
  JsonObject,
  SetPasswordInput,
  StartLoginInput,
  StartLoginResponse
} from '@auth-sandbox-2/shared-types'

import {
  completePublicAssuranceFlowMethod,
  createPublicAssuranceFlow,
  finalizePublicAssuranceFlow,
  registerDeviceViaFlow,
  selectPublicAssuranceFlowService,
  startPublicAssuranceFlowMethod
} from './assurance-flows.js'
import { createEncryptedChallenge, generateEncryptionKeyPair, hashPublicKey } from './lib/crypto.js'
import { generateActivationCode } from './lib/password.js'
import { KeycloakAdminClient, KeycloakAuthClient } from './keycloak.js'
import type {
  ChallengeRow,
  DeviceRow,
  RegistrationCodeRow,
  RegistrationPersonCodeRow,
  RegistrationPersonRow,
  RegistrationPersonSmsNumberRow
} from './types.js'

const adminClient = new KeycloakAdminClient()
const authClient = new KeycloakAuthClient()

type FlowServiceHandler = {
  method: 'code' | 'sms'
  selectionPayload: JsonObject
  start: (flowId: string) => Promise<Awaited<ReturnType<typeof startPublicAssuranceFlowMethod>>>
  complete: (flowId: string, payload: JsonObject) => Promise<Awaited<ReturnType<typeof completePublicAssuranceFlowMethod>>>
  resend?: (flowId: string) => Promise<Awaited<ReturnType<typeof startPublicAssuranceFlowMethod>>>
}

function notFound(message: string) {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = 404
  return error
}

function badRequest(message: string) {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = 400
  return error
}

const flowServiceRegistry: Record<AssuranceFlowService, FlowServiceHandler> = {
  person_code: {
    method: 'code',
    selectionPayload: { service: 'person_code' },
    start: (flowId) => startPublicAssuranceFlowMethod(flowId, 'code', {
      payload: { service: 'person_code' }
    }),
    complete: (flowId, payload) => completePublicAssuranceFlowMethod(flowId, 'code', {
      payload
    })
  },
  sms_tan: {
    method: 'sms',
    selectionPayload: { service: 'sms_tan' },
    start: (flowId) => startPublicAssuranceFlowMethod(flowId, 'sms', {
      payload: { service: 'sms_tan' }
    }),
    complete: (flowId, payload) => completePublicAssuranceFlowMethod(flowId, 'sms', {
      payload
    }),
    resend: (flowId) => startPublicAssuranceFlowMethod(flowId, 'sms', {
      payload: { service: 'sms_tan' }
    })
  }
}

function getFlowServiceHandler(service: AssuranceFlowService) {
  const handler = flowServiceRegistry[service]
  if (!handler) {
    throw badRequest(`Unsupported assurance flow service: ${service}`)
  }
  return handler
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

function mapRegistrationPerson(row: RegistrationPersonRow): RegistrationPersonRecord {
  return {
    id: row.id,
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapRegistrationPersonCode(row: RegistrationPersonCodeRow): RegistrationPersonCodeRecord {
  return {
    id: row.id,
    personId: row.person_id,
    code: row.code,
    expiresAt: row.expires_at,
    useCount: row.use_count,
    createdAt: row.created_at
  }
}

function mapRegistrationPersonSmsNumber(row: RegistrationPersonSmsNumberRow): RegistrationPersonSmsNumberRecord {
  return {
    id: row.id,
    personId: row.person_id,
    phoneNumber: row.phone_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

export async function createRegistrationIdentity(input: CreateRegistrationIdentityInput) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'create_registration_identity',
      userId: input.userId,
      notes: 'Create separated person, code, and sms registration identity records.'
    },
    async () => withTransaction(async (client) => {
      await adminClient.ensureUser(input.userId, `${input.firstName} ${input.lastName}`)

      const personResult = await client.query<RegistrationPersonRow>(
        `insert into registration_people (user_id, first_name, last_name, birth_date)
         values ($1, $2, $3, $4)
         on conflict (user_id) do update
         set first_name = excluded.first_name,
             last_name = excluded.last_name,
             birth_date = excluded.birth_date,
             updated_at = now()
         returning *`,
        [input.userId, input.firstName, input.lastName, input.birthDate]
      )

      const person = personResult.rows[0]
      let code: RegistrationPersonCodeRecord | null = null
      let smsNumber: RegistrationPersonSmsNumberRecord | null = null

      if (input.code) {
        const codeResult = await client.query<RegistrationPersonCodeRow>(
          `insert into registration_person_codes (person_id, code, expires_at)
           values ($1, $2, now() + ($3 || ' days')::interval)
           returning *`,
          [person.id, input.code, input.codeValidForDays ?? 90]
        )
        code = mapRegistrationPersonCode(codeResult.rows[0])
      }

      if (input.phoneNumber) {
        const smsResult = await client.query<RegistrationPersonSmsNumberRow>(
          `insert into registration_person_sms_numbers (person_id, phone_number)
           values ($1, $2)
           on conflict (person_id) do update
           set phone_number = excluded.phone_number,
               updated_at = now()
           returning *`,
          [person.id, input.phoneNumber]
        )
        smsNumber = mapRegistrationPersonSmsNumber(smsResult.rows[0])
      }

      return {
        person: mapRegistrationPerson(person),
        code,
        smsNumber
      }
    })
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

export async function startFlowService(flowId: string, service: AssuranceFlowService) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'start_flow_service',
      challengeId: flowId,
      notes: `Start concrete flow service ${service}.`
    },
    async () => getFlowServiceHandler(service).start(flowId)
  )
}

export async function selectFlowService(flowId: string, service: AssuranceFlowService) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'select_flow_service',
      challengeId: flowId,
      notes: `Select concrete flow service ${service}.`
    },
    async () => selectPublicAssuranceFlowService(flowId, service)
  )
}

export async function completeFlowService(flowId: string, service: AssuranceFlowService, payload: JsonObject) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'complete_flow_service',
      challengeId: flowId,
      notes: `Complete concrete flow service ${service}.`
    },
    async () => getFlowServiceHandler(service).complete(flowId, payload)
  )
}

export async function resendFlowService(flowId: string, service: AssuranceFlowService) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'resend_flow_service',
      challengeId: flowId,
      notes: `Resend concrete flow service ${service}.`
    },
    async () => {
      const handler = getFlowServiceHandler(service)
      if (!handler.resend) {
        throw badRequest(`Service ${service} does not support resend`)
      }
      return handler.resend(flowId)
    }
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
  requiredAcr?: 'level_1' | 'level_2'
}) {
  const created = await createPublicAssuranceFlow({
    purpose: 'step_up',
    subjectId: input.userId,
    requiredAcr: input.requiredAcr ?? 'level_1',
    context: {
      phoneNumber: input.phoneNumber
    }
  } satisfies CreateFlowInput)
  await selectPublicAssuranceFlowService(created.flowId, 'sms_tan')
  const started = await startFlowService(created.flowId, 'sms_tan')
  const completed = await completeFlowService(created.flowId, 'sms_tan', {
    tan: started.devCode ?? '000000'
  })
  return finalizePublicAssuranceFlow(created.flowId, { serviceResultToken: completed.serviceResultToken, channel: 'browser' })
}

export async function completeMobileStepUp(input: {
  userId: string
  phoneNumber: string
  refreshToken?: string
}) {
  const created = await createPublicAssuranceFlow({
    purpose: 'step_up',
    subjectId: input.userId,
    requiredAcr: 'level_1',
    context: {
      phoneNumber: input.phoneNumber
    }
  })
  await selectPublicAssuranceFlowService(created.flowId, 'sms_tan')
  const started = await startFlowService(created.flowId, 'sms_tan')
  const completed = await completeFlowService(created.flowId, 'sms_tan', { tan: started.devCode ?? '000000' })
  const finalized = await finalizePublicAssuranceFlow(created.flowId, { serviceResultToken: completed.serviceResultToken, channel: 'mobile' })
  if (!finalized.finalization || finalized.finalization.kind !== 'assurance_handle') {
    throw new Error('Mobile step-up flow did not yield an assurance handle')
  }
  const tokens = await authClient.authenticateWithAssuranceHandle(finalized.finalization.assuranceHandle, input.refreshToken)
  return {
    flow: finalized,
    tokens
  }
}

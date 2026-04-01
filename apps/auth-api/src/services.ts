import { randomUUID } from 'node:crypto'

import { appConfig, logger, pool, recordArtifact, runWithSpan, withTransaction } from '@auth-sandbox-2/backend-core'
import type {
  AssuranceFlowService,
  CreateSsoLaunchInput,
  CreateSsoLaunchResponse,
  CreateRegistrationIdentityInput,
  DeviceRecord,
  FinishLoginInput,
  FinishLoginResponse,
  LogoutResponse,
  RefreshTokensInput,
  RefreshTokensResponse,
  RegistrationIdentityRecord,
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
  createStepUpFlow,
  finalizePublicAssuranceFlow,
  selectPublicAssuranceFlowService,
  startPublicAssuranceFlowMethod
} from './assurance-flows.js'
import { verifyServiceToken } from './flow-tokens.js'
import { createEncryptedChallenge, generateEncryptionKeyPair, hashPublicKey } from './lib/crypto.js'
import { KeycloakAdminClient, KeycloakAuthClient } from './keycloak.js'
import { buildSsoBootstrapTargetUrl, createSsoBootstrapState, getSsoBootstrapTarget, verifySsoBootstrapState } from './sso-bootstrap.js'
import type {
  ChallengeRow,
  DeviceRow,
  RegistrationIdentityRow,
  RegistrationPersonCodeRow,
  RegistrationPersonRow,
  RegistrationPersonSmsNumberRow
} from './types.js'

const adminClient = new KeycloakAdminClient()
const authClient = new KeycloakAuthClient()

type FlowServiceHandler = {
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

function unauthorized(message: string) {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = 401
  return error
}

const flowServiceRegistry: Record<AssuranceFlowService, FlowServiceHandler> = {
  person_code: {
    start: (flowId) => startPublicAssuranceFlowMethod(flowId, 'code', {
      payload: { service: 'person_code' }
    }),
    complete: (flowId, payload) => completePublicAssuranceFlowMethod(flowId, 'code', {
      payload
    })
  },
  sms_tan: {
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

function mapRegistrationIdentity(row: RegistrationIdentityRow): RegistrationIdentityRecord {
  return {
    id: row.id,
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    code: row.code,
    codeExpiresAt: row.code_expires_at,
    codeUseCount: row.code_use_count,
    phoneNumber: row.phone_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
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

export async function listDevices() {
  const result = await pool.query<DeviceRow>('select * from devices order by created_at desc')
  return result.rows.map(mapDevice)
}

export async function listRegistrationIdentities() {
  const result = await pool.query<RegistrationIdentityRow>(
    `select
       people.id,
       people.user_id,
       people.first_name,
       people.last_name,
       people.birth_date,
       latest_code.code,
       latest_code.expires_at as code_expires_at,
       latest_code.use_count as code_use_count,
       sms.phone_number,
       people.created_at,
       people.updated_at
     from registration_people people
     left join lateral (
       select code, expires_at, use_count
       from registration_person_codes
       where person_id = people.id
       order by created_at desc
       limit 1
     ) latest_code on true
     left join registration_person_sms_numbers sms on sms.person_id = people.id
     order by people.updated_at desc, people.created_at desc`
  )

  return result.rows.map(mapRegistrationIdentity)
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

export async function startKeycloakBrowserStepUp(userId: string) {
  const created = await createStepUpFlow({
    userId,
    requiredAcr: 'level_2'
  })
  const selected = await selectPublicAssuranceFlowService(created.flowId, 'sms_tan')
  const started = await startFlowService(created.flowId, 'sms_tan')
  if (!selected.serviceToken) {
    throw new Error('SMS-TAN selection did not yield a service token')
  }
  return {
    flowId: created.flowId,
    serviceToken: selected.serviceToken,
    maskedTarget: started.maskedTarget,
    devCode: started.devCode ?? null
  }
}

export async function completeKeycloakBrowserStepUp(input: {
  flowId: string
  serviceToken: string
  tan: string
}) {
  const verified = verifyServiceToken(input.serviceToken, 'sms_tan')
  if (!verified.ok || verified.claims.flowId !== input.flowId) {
    throw badRequest('Invalid service token for browser step-up')
  }

  const completed = await completeFlowService(input.flowId, 'sms_tan', { tan: input.tan })
  return finalizePublicAssuranceFlow(input.flowId, {
    serviceResultToken: completed.serviceResultToken,
    channel: 'keycloak'
  })
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
        // Trace-only inspection payload: the response body below returns only
        // nonce/encryptedKey/encryptedData/iv/expiresAt, while this artifact
        // also keeps the decrypted challenge payload for the trace explorer.
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
      const { loginToken } = await consumeLoginChallengeAndCreateLoginToken(input)
      await recordArtifact({
        spanId,
        artifactType: 'jwt',
        name: 'login_token_payload',
        contentType: 'application/jwt',
        encoding: 'base64url',
        direction: 'outbound',
        rawValue: loginToken,
        // Trace artifact for inspection of the Keycloak handoff payload.
        // This encoded value is sent only to Keycloak, not back to the client.
        explanation: 'Base64URL-encoded login token payload forwarded into Keycloak device authentication.'
      })
      const tokens = await authClient.authenticate(loginToken)
      return tokens
    }
  )
}

async function consumeLoginChallengeAndCreateLoginToken(input: FinishLoginInput) {
  const challenge = await getUsableLoginChallenge(input.nonce)

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

  return {
    challenge,
    loginToken: Buffer.from(JSON.stringify(loginTokenPayload)).toString('base64url')
  }
}

async function getUsableLoginChallenge(nonce: string) {
  const challengeResult = await pool.query<ChallengeRow>('select * from login_challenges where nonce = $1', [nonce])
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

  return challenge
}

export async function createSsoLaunch(input: CreateSsoLaunchInput & { authenticatedUserId: string }): Promise<CreateSsoLaunchResponse> {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'create_sso_launch',
      userId: input.authenticatedUserId,
      challengeId: input.nonce,
      notes: `Create SSO bootstrap launch for ${input.targetId}.`
    },
    async (spanId) => {
      const challenge = await getUsableLoginChallenge(input.nonce)
      if (challenge.user_id !== input.authenticatedUserId) {
        throw unauthorized('Challenge user does not match bearer token user')
      }

      const { loginToken } = await consumeLoginChallengeAndCreateLoginToken(input)

      const target = getSsoBootstrapTarget(input.targetId)
      const state = createSsoBootstrapState({
        targetId: input.targetId,
        targetPath: input.targetPath,
        requestedAcr: input.requestedAcr
      })
      const launch = await authClient.createSsoBootstrapLaunch({
        loginToken,
        state,
        requestedAcr: input.requestedAcr
      })

      await recordArtifact({
        spanId,
        artifactType: 'text',
        name: 'sso_bootstrap_state',
        contentType: 'text/plain',
        encoding: 'raw',
        direction: 'outbound',
        rawValue: state,
        explanation: 'Signed short-lived bootstrap state carrying the allowlisted target metadata.'
      })
      await recordArtifact({
        spanId,
        artifactType: 'url',
        name: 'sso_bootstrap_auth_url',
        contentType: 'text/uri-list',
        encoding: 'raw',
        direction: 'outbound',
        rawValue: launch.authUrl,
        explanation: 'Keycloak authorization URL created from the PAR request_uri for browser bootstrap.'
      })

      return {
        launchUrl: launch.authUrl,
        targetUrl: buildSsoBootstrapTargetUrl(target, input.targetPath)
      }
    }
  )
}

export async function completeSsoBootstrapCallback(input: { state: string; code: string }) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'complete_sso_bootstrap_callback',
      notes: 'Redeem bootstrap authorization code and resolve the final allowlisted target redirect.'
    },
    async (spanId) => {
      const verifiedState = verifySsoBootstrapState(input.state)
      if (!verifiedState.ok) {
        throw badRequest(verifiedState.reason === 'expired' ? 'Bootstrap state expired' : 'Invalid bootstrap state')
      }

      await authClient.redeemSsoBootstrapCode(input.code)
      const target = getSsoBootstrapTarget(verifiedState.claims.targetId)
      const redirectUrl = buildSsoBootstrapTargetUrl(target, verifiedState.claims.targetPath)

      await recordArtifact({
        spanId,
        artifactType: 'url',
        name: 'sso_bootstrap_target_url',
        contentType: 'text/uri-list',
        encoding: 'raw',
        direction: 'outbound',
        rawValue: redirectUrl,
        explanation: 'Allowlisted target URL selected from the signed bootstrap state after code redemption.'
      })

      return {
        redirectUrl,
        state: verifiedState.claims
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

export async function completeMobileStepUp(input: {
  userId: string
  phoneNumber: string
  refreshToken?: string
}) {
  const created = await createStepUpFlow({
    userId: input.userId,
    requiredAcr: 'level_1',
    phoneNumber: input.phoneNumber
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

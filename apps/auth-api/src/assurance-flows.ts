import { randomInt, randomUUID } from 'node:crypto'

import { appConfig, logger, pool, runWithSpan, withTransaction } from '@auth-sandbox-2/backend-core'
import type {
  AcrLevel,
  AssuranceFlowFinalization,
  AssuranceFlowMethod,
  AssuranceFlowMethodSummary,
  AssuranceFlowNextAction,
  AssuranceFlowRecord,
  PublicAssuranceFlowRecord,
  AssuranceFlowService,
  AssuranceFlowServiceOption,
  CreateFlowResponse,
  AssuranceFlowResultSummary,
  CreateFlowInput,
  FinalizeFlowChannel,
  FinalizeFlowResponse,
  GetFlowResponse,
  RedeemFlowArtifactResponse,
  JsonObject
} from '@auth-sandbox-2/shared-types'

import { createEncryptedChallenge, generateEncryptionKeyPair, hashPublicKey } from './lib/crypto.js'
import { createFlowToken, createServiceResultToken, createServiceToken, verifyServiceResultToken } from './flow-tokens.js'
import { KeycloakAdminClient } from './keycloak.js'
import type {
  AssuranceFlowEventRow,
  AssuranceFlowJson,
  AssuranceFlowPurpose,
  AssuranceFlowRow,
  AssuranceFlowStatus,
  DeviceRow,
  RegistrationCodeRow,
  RegistrationPersonCodeRow,
  RegistrationPersonRow,
  RegistrationPersonSmsNumberRow
} from './types.js'

type QueryResultRow<T> = {
  rows: T[]
  rowCount: number | null
}

type Queryable = {
  query: <T>(text: string, params?: unknown[]) => Promise<QueryResultRow<T>>
}

type MethodStartResult = {
  row: AssuranceFlowRow
  eventType: string
}

type MethodCompleteResult = {
  row: AssuranceFlowRow
  eventType: string
}

type FinalizeResult = {
  row: AssuranceFlowRow
  eventType: string
}

export type CreateAssuranceFlowInput = {
  id?: string
  purpose: AssuranceFlowPurpose
  requiredAcr?: AcrLevel | null
  deviceId?: string | null
  subjectId?: string | null
  resolvedUserId?: string | null
  selectedService?: AssuranceFlowService | null
  challengeBinding?: AssuranceFlowJson
  context?: AssuranceFlowJson
  methodState?: AssuranceFlowJson
  result?: AssuranceFlowJson
  idempotencyKey?: string | null
  expiresAt?: string
}

export type UpdateAssuranceFlowInput = {
  status?: AssuranceFlowStatus
  selectedService?: AssuranceFlowService | null
  requiredAcr?: AcrLevel | null
  deviceId?: string | null
  subjectId?: string | null
  resolvedUserId?: string | null
  challengeBinding?: AssuranceFlowJson
  context?: AssuranceFlowJson
  methodState?: AssuranceFlowJson
  result?: AssuranceFlowJson
  idempotencyKey?: string | null
  finalizedAt?: string | null
  expiresAt?: string
  finalArtifactKind?: string | null
  finalArtifactCode?: string | null
  finalArtifactExpiresAt?: string | null
  finalArtifactConsumedAt?: string | null
}

export type FlowEventInput = {
  flowId: string
  eventType: string
  payload?: AssuranceFlowJson
}

type FlowMethodState = {
  method?: AssuranceFlowMethod
  service?: AssuranceFlowService
  state?: string
  target?: string
  maskedTarget?: string
  code?: string
  personCodeId?: string
  verifiedAt?: string
  nonce?: string
  encryptedKey?: string
  encryptedData?: string
  iv?: string
  publicKey?: string
  publicKeyHash?: string
  deviceName?: string
}

const adminClient = new KeycloakAdminClient()
const defaultTtlMs = 10 * 60 * 1000
const artifactTtlMs = 5 * 60 * 1000
const terminalStatuses = new Set<AssuranceFlowStatus>(['finalized', 'failed', 'expired'])

type AssuranceServiceDefinition = AssuranceFlowServiceOption & {
  purposes: AssuranceFlowPurpose[]
  method: AssuranceFlowMethod
  isAvailable: (flow: AssuranceFlowRow, db: Queryable) => Promise<boolean>
}

const acrRank: Record<AcrLevel, number> = {
  level_1: 1,
  level_2: 2
}

function satisfiesRequiredAcr(achievedAcr: AcrLevel, requiredAcr: AcrLevel) {
  return acrRank[achievedAcr] >= acrRank[requiredAcr]
}

async function hasRegistrationPersonCode(flow: AssuranceFlowRow, db: Queryable) {
  try {
    const person = await getRegistrationPersonForFlow(flow, db)
    const result = await db.query<{ id: string }>(
      `select id from registration_person_codes
       where person_id = $1 and expires_at >= now()
       order by expires_at desc
       limit 1`,
      [person.id]
    )
    return Boolean(result.rows[0])
  } catch {
    return false
  }
}

async function hasRegistrationSmsNumber(flow: AssuranceFlowRow, db: Queryable) {
  try {
    const person = await getRegistrationPersonForFlow(flow, db)
    const result = await db.query<{ id: string }>(
      'select id from registration_person_sms_numbers where person_id = $1 limit 1',
      [person.id]
    )
    return Boolean(result.rows[0])
  } catch {
    return false
  }
}

async function hasStepUpSmsNumber(flow: AssuranceFlowRow, db: Queryable) {
  const context = readContext(flow)
  if (typeof context.phoneNumber === 'string' && context.phoneNumber.trim().length > 0) {
    return true
  }

  const userId = flow.resolved_user_id ?? flow.prospective_user_id ?? flow.user_hint
  if (!userId) {
    return false
  }

  const result = await db.query<{ id: string }>(
    `select s.id
     from registration_person_sms_numbers s
     join registration_people p on p.id = s.person_id
     where p.user_id = $1
     limit 1`,
    [userId]
  )
  return Boolean(result.rows[0])
}

const assuranceServiceRegistry: Record<AssuranceFlowService, AssuranceServiceDefinition> = {
  person_code: {
    id: 'person_code',
    label: 'Personencode',
    achievedAcr: 'level_2',
    method: 'code',
    purposes: ['registration'],
    isAvailable: hasRegistrationPersonCode
  },
  sms_tan: {
    id: 'sms_tan',
    label: 'SMS-TAN',
    achievedAcr: 'level_2',
    method: 'sms',
    purposes: ['registration', 'step_up'],
    isAvailable: async (flow, db) => (flow.purpose === 'registration' ? hasRegistrationSmsNumber(flow, db) : hasStepUpSmsNumber(flow, db))
  }
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

function assertPurpose(purpose: string): asserts purpose is AssuranceFlowPurpose {
  if (!['registration', 'account_upgrade', 'step_up'].includes(purpose)) {
    throw new Error(`Unsupported assurance flow purpose: ${purpose}`)
  }
}

function assertStatus(status: string): asserts status is AssuranceFlowStatus {
  if (!['started', 'method_in_progress', 'method_verified', 'finalizable', 'finalized', 'failed', 'expired'].includes(status)) {
    throw new Error(`Unsupported assurance flow status: ${status}`)
  }
}

function defaultExpiresAt() {
  return new Date(Date.now() + defaultTtlMs).toISOString()
}

function defaultArtifactExpiresAt() {
  return new Date(Date.now() + artifactTtlMs).toISOString()
}

function ensureJson(value?: AssuranceFlowJson) {
  return value ?? {}
}

function asJsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function readMethodState(row: AssuranceFlowRow): FlowMethodState {
  return asJsonObject(row.method_state_json) as FlowMethodState
}

function readContext(row: AssuranceFlowRow) {
  return asJsonObject(row.context_json)
}

function readResult(row: AssuranceFlowRow) {
  return asJsonObject(row.result_json)
}

function buildNextAction(status: AssuranceFlowStatus): AssuranceFlowNextAction {
  switch (status) {
    case 'started':
      return 'select_service'
    case 'method_in_progress':
    case 'method_verified':
      return 'use_service'
    case 'finalizable':
      return 'finalize'
    default:
      return null
  }
}

function buildMethodSummary(row: AssuranceFlowRow): AssuranceFlowMethodSummary | null {
  const methodState = readMethodState(row)
  if (!methodState.method) {
    return null
  }

  return {
    kind: methodState.method,
    state: methodState.state ?? row.status,
    maskedTarget: methodState.maskedTarget ?? null,
    devCode: methodState.code ?? null
  }
}

async function buildAvailableServices(row: AssuranceFlowRow, db: Queryable): Promise<AssuranceFlowServiceOption[]> {
  const requiredAcr = (row.requested_acr === 'level_1' || row.requested_acr === 'level_2' ? row.requested_acr : 'level_1') satisfies AcrLevel
  const services = Object.values(assuranceServiceRegistry).filter((service) => service.purposes.includes(row.purpose) && satisfiesRequiredAcr(service.achievedAcr, requiredAcr))
  const availability = await Promise.all(services.map(async (service) => ({
    service,
    available: await service.isAvailable(row, db)
  })))
  return availability.filter((entry) => entry.available).map((entry) => ({
    id: entry.service.id,
    label: entry.service.label,
    achievedAcr: entry.service.achievedAcr
  }))
}

function buildResultSummary(row: AssuranceFlowRow): AssuranceFlowResultSummary | null {
  const result = readResult(row)
  const assurance = Array.isArray(result.assurance)
    ? result.assurance.filter((entry): entry is string => typeof entry === 'string')
    : []
  return assurance.length
    ? {
        assurance,
        achievedAcr: result.achievedAcr === 'level_1' || result.achievedAcr === 'level_2' ? result.achievedAcr : undefined,
        deviceId: typeof result.deviceId === 'string' ? result.deviceId : undefined,
        publicKeyHash: typeof result.publicKeyHash === 'string' ? result.publicKeyHash : undefined
      }
    : null
}

function buildFinalization(row: AssuranceFlowRow): AssuranceFlowFinalization | null {
  const result = readResult(row)
  if (row.final_artifact_kind === 'assurance_handle' && row.final_artifact_code && row.final_artifact_expires_at) {
    return {
      kind: 'assurance_handle',
      assuranceHandle: row.final_artifact_code,
      expiresAt: row.final_artifact_expires_at
    }
  }

  if (row.final_artifact_kind === 'result_code' && row.final_artifact_code && row.final_artifact_expires_at) {
    return {
      kind: 'result_code',
      resultCode: row.final_artifact_code,
      expiresAt: row.final_artifact_expires_at
    }
  }

  if (row.final_artifact_kind === 'registration_result' && typeof result.userId === 'string' && typeof result.passwordSetupRequired === 'boolean') {
    return {
      kind: 'registration_result',
      userId: result.userId,
      deviceId: typeof result.deviceId === 'string' ? result.deviceId : undefined,
      publicKeyHash: typeof result.publicKeyHash === 'string' ? result.publicKeyHash : undefined,
      passwordSetupRequired: result.passwordSetupRequired
    }
  }

  return null
}

function mapFlowRow(row: AssuranceFlowRow): AssuranceFlowRow {
  assertPurpose(row.purpose)
  assertStatus(row.status)
  return {
    ...row,
    challenge_binding_json: ensureJson(row.challenge_binding_json),
    context_json: ensureJson(row.context_json),
    method_state_json: ensureJson(row.method_state_json),
    result_json: ensureJson(row.result_json)
  }
}

function generateSmsCode() {
  return String(randomInt(100000, 1000000))
}

function maskPhone(target: string) {
  if (target.length <= 4) {
    return target
  }
  return `${target.slice(0, 3)}******${target.slice(-3)}`
}

function generateArtifactCode(prefix: 'ah' | 'rc') {
  return `${prefix}_${randomUUID()}`
}

async function getRegistrationCodeForFlow(flow: AssuranceFlowRow, db: Queryable) {
  const context = readContext(flow)
  const activationCode = typeof context.activationCode === 'string' ? context.activationCode : null
  const userId = flow.prospective_user_id ?? flow.user_hint
  if (!activationCode || !userId) {
    throw badRequest('Registration flow is missing activation code or user id')
  }

  const result = await db.query<RegistrationCodeRow>(
    'select * from registration_codes where user_id = $1 and code = $2',
    [userId, activationCode]
  )
  const row = result.rows[0]
  if (!row) {
    throw badRequest('Invalid registration code')
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw badRequest('Registration code expired')
  }
  return row
}

async function getRegistrationPersonForFlow(flow: AssuranceFlowRow, db: Queryable) {
  const context = readContext(flow)
  const userId = flow.prospective_user_id ?? flow.user_hint
  const firstName = typeof context.firstName === 'string' ? context.firstName.trim() : ''
  const lastName = typeof context.lastName === 'string' ? context.lastName.trim() : ''
  const birthDate = typeof context.birthDate === 'string' ? context.birthDate : ''

  if (!userId || !firstName || !lastName || !birthDate) {
    throw badRequest('Registration flow is missing person identity data')
  }

  const result = await db.query<RegistrationPersonRow>(
    `select * from registration_people
     where user_id = $1 and first_name = $2 and last_name = $3 and birth_date = $4`,
    [userId, firstName, lastName, birthDate]
  )

  const row = result.rows[0]
  if (!row) {
    throw badRequest('Unknown registration identity')
  }

  return row
}

async function getRegistrationPersonCodeForFlow(flow: AssuranceFlowRow, db: Queryable) {
  return getRegistrationPersonCodeForInput(readContext(flow).identityInput, flow, db)
}

async function getRegistrationPersonCodeForInput(inputValue: unknown, flow: AssuranceFlowRow, db: Queryable) {
  const context = readContext(flow)
  const identityInput = asJsonObject(inputValue ?? context.identityInput)
  const codeValue = typeof identityInput.code === 'string' ? identityInput.code.trim() : ''
  const person = await getRegistrationPersonForFlow(flow, db)
  if (!codeValue) {
    throw badRequest('Registration flow is missing code value')
  }

  const result = await db.query<RegistrationPersonCodeRow>(
    'select * from registration_person_codes where person_id = $1 and code = $2',
    [person.id, codeValue]
  )
  const row = result.rows[0]
  if (!row) {
    throw badRequest('Invalid registration code')
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw badRequest('Registration code expired')
  }
  return { person, code: row }
}

async function getRegistrationPersonCodeById(codeId: string, db: Queryable) {
  const result = await db.query<RegistrationPersonCodeRow>('select * from registration_person_codes where id = $1', [codeId])
  const row = result.rows[0]
  if (!row) {
    throw badRequest('Invalid registration code reference')
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw badRequest('Registration code expired')
  }
  return row
}

function readIdentityService(flow: AssuranceFlowRow): AssuranceFlowService | null {
  const context = readContext(flow)
  return context.identityService === 'person_code' || context.identityService === 'sms_tan'
    ? context.identityService
    : null
}

async function getRegistrationSmsNumberForFlow(flow: AssuranceFlowRow, db: Queryable) {
  const person = await getRegistrationPersonForFlow(flow, db)
  const result = await db.query<RegistrationPersonSmsNumberRow>(
    'select * from registration_person_sms_numbers where person_id = $1',
    [person.id]
  )
  const row = result.rows[0]
  if (!row) {
    throw badRequest('No SMS target is stored for this registration identity')
  }
  return { person, smsNumber: row }
}

async function getSmsNumberByUserId(userId: string, db: Queryable) {
  const result = await db.query<RegistrationPersonSmsNumberRow>(
    `select s.*
     from registration_person_sms_numbers s
     join registration_people p on p.id = s.person_id
     where p.user_id = $1
     limit 1`,
    [userId]
  )
  return result.rows[0] ?? null
}

async function ensureRegistrationDeviceState(flow: AssuranceFlowRow, db: Queryable) {
  const methodState = readMethodState(flow)
  const context = readContext(flow)
  const userId = flow.prospective_user_id ?? flow.user_hint
  const deviceName = typeof context.deviceName === 'string' ? context.deviceName : null
  const publicKey = typeof context.publicKey === 'string' ? context.publicKey : null

  if (!userId || !deviceName || !publicKey) {
    throw badRequest('Registration flow is missing user or device context')
  }

  const publicKeyHash = methodState.publicKeyHash ?? hashPublicKey(publicKey)
  const duplicate = await db.query('select 1 from devices where user_id = $1 and device_name = $2', [userId, deviceName])
  if (duplicate.rowCount) {
    throw badRequest('Device name already exists for this user')
  }

  return {
    ...methodState,
    method: methodState.method ?? 'code',
    state: 'device_verified',
    publicKey,
    publicKeyHash,
    deviceName
  } satisfies FlowMethodState
}

async function finalizeRegistration(flow: AssuranceFlowRow, db: Queryable): Promise<FinalizeResult> {
  const activeMethodState = readMethodState(flow)
  const verificationMethod = activeMethodState.method ?? 'code'
  const verificationService = activeMethodState.service ?? readIdentityService(flow)
  const person = await getRegistrationPersonForFlow(flow, db)
  const smsIdentity = verificationMethod === 'sms' ? await getRegistrationSmsNumberForFlow(flow, db) : null
  const methodState = await ensureRegistrationDeviceState(flow, db)
  const userId = flow.prospective_user_id ?? flow.user_hint
  const deviceName = methodState.deviceName
  const publicKey = methodState.publicKey
  const publicKeyHash = methodState.publicKeyHash

  if (!userId || !deviceName || !publicKey || !publicKeyHash) {
    throw badRequest('Registration flow is missing device material')
  }

  const displayName = `${person.first_name} ${person.last_name}`
  const keycloakUserId = await adminClient.ensureUser(userId, displayName)
  const encryptionKeys = generateEncryptionKeyPair()
  const credentialId = await adminClient.createDeviceCredential({
    userId,
    deviceName,
    publicKey,
    publicKeyHash,
    encPrivKey: encryptionKeys.privateKeyPem
  })

  const deviceResult = await db.query<DeviceRow>(
    `insert into devices (user_id, device_name, public_key, public_key_hash, enc_pub_key, keycloak_user_id, keycloak_credential_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [userId, deviceName, publicKey, publicKeyHash, encryptionKeys.publicKeyPem, keycloakUserId, credentialId]
  )

  if (verificationService === 'person_code') {
    if (!activeMethodState.personCodeId) {
      throw badRequest('Registration flow is missing verified code reference')
    }
    const code = await getRegistrationPersonCodeById(activeMethodState.personCodeId, db)
    if (code.person_id !== person.id) {
      throw badRequest('Registration code does not belong to the selected person')
    }
    await db.query('update registration_person_codes set use_count = use_count + 1 where id = $1', [code.id])
  }

  if (smsIdentity && smsIdentity.person.id !== person.id) {
    throw badRequest('Registration SMS identity does not belong to the selected person')
  }
  const passwordSetupRequired = !(await adminClient.hasPassword(userId))
  const nextResult = {
    assurance: [verificationMethod === 'sms' ? 'phone_verified' : 'activation_code_verified', 'device_registered'],
    achievedAcr: 'level_2' as const,
    userId,
    deviceId: deviceResult.rows[0].id,
    publicKeyHash,
    passwordSetupRequired
  }

  const row = await updateAssuranceFlow(flow.id, {
    status: 'finalized',
    resolvedUserId: userId,
    methodState,
    result: nextResult,
    finalArtifactKind: 'registration_result',
    finalArtifactCode: null,
    finalArtifactExpiresAt: null,
    finalArtifactConsumedAt: null
  }, db)

  if (!row) {
    throw notFound('Unknown flow')
  }

  logger.info({ flowId: flow.id, userId, deviceName }, 'Finalized registration flow')

  return {
    row,
    eventType: 'flow_finalized_registration'
  }
}

async function finalizeStepUp(flow: AssuranceFlowRow, channel: FinalizeFlowChannel, db: Queryable): Promise<FinalizeResult> {
  const current = flow.status === 'finalized' ? flow : await updateAssuranceFlow(flow.id, {
    status: 'finalized',
    result: readResult(flow)
  }, db)
  if (!current) {
    throw notFound('Unknown flow')
  }

  if (current.final_artifact_kind && current.final_artifact_code && current.final_artifact_expires_at) {
    return {
      row: current,
      eventType: current.final_artifact_kind === 'assurance_handle' ? 'flow_finalized_assurance_handle' : 'flow_finalized_result_code'
    }
  }

  const artifactKind = channel === 'browser' ? 'result_code' : 'assurance_handle'
  const artifactCode = generateArtifactCode(channel === 'browser' ? 'rc' : 'ah')
  const artifactExpiresAt = defaultArtifactExpiresAt()
  const result = readResult(current)
  const nextRow = await updateAssuranceFlow(flow.id, {
    status: 'finalized',
      result: {
        ...result,
        authTime: result.authTime ?? new Date().toISOString(),
        achievedAcr: result.achievedAcr ?? current.requested_acr ?? null,
        amr: Array.isArray(result.amr) ? result.amr : ['sms']
      },
    finalArtifactKind: artifactKind,
    finalArtifactCode: artifactCode,
    finalArtifactExpiresAt: artifactExpiresAt,
    finalArtifactConsumedAt: null
  }, db)

  if (!nextRow) {
    throw notFound('Unknown flow')
  }

  return {
    row: nextRow,
    eventType: artifactKind === 'assurance_handle' ? 'flow_finalized_assurance_handle' : 'flow_finalized_result_code'
  }
}

export function isTerminalAssuranceFlowStatus(status: AssuranceFlowStatus) {
  return terminalStatuses.has(status)
}

export function canTransitionAssuranceFlowStatus(from: AssuranceFlowStatus, to: AssuranceFlowStatus) {
  if (from === to) {
    return true
  }

  switch (from) {
    case 'started':
      return to === 'method_in_progress' || to === 'failed' || to === 'expired'
    case 'method_in_progress':
      return to === 'method_verified' || to === 'finalizable' || to === 'failed' || to === 'expired'
    case 'method_verified':
      return to === 'finalizable' || to === 'failed' || to === 'expired'
    case 'finalizable':
      return to === 'finalized' || to === 'failed' || to === 'expired'
    case 'finalized':
    case 'failed':
    case 'expired':
      return false
  }
}

export function assertAssuranceFlowTransition(from: AssuranceFlowStatus, to: AssuranceFlowStatus) {
  if (!canTransitionAssuranceFlowStatus(from, to)) {
    throw new Error(`Invalid assurance flow status transition: ${from} -> ${to}`)
  }
}

export async function createAssuranceFlow(input: CreateAssuranceFlowInput, db: Queryable = pool) {
  const flowId = input.id ?? randomUUID()
  const result = await db.query<AssuranceFlowRow>(
    `insert into assurance_flows (
       id,
       purpose,
       status,
       current_method,
       requested_acr,
       target_assurance,
       device_id,
       user_hint,
       prospective_user_id,
       resolved_user_id,
       challenge_binding_json,
       context_json,
       method_state_json,
       result_json,
       idempotency_key,
       expires_at,
       final_artifact_kind,
       final_artifact_code,
       final_artifact_expires_at,
       final_artifact_consumed_at
     ) values (
       $1, $2, 'started', $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, null, null, null, null
     )
     returning *`,
    [
      flowId,
      input.purpose,
      input.selectedService ?? null,
      input.requiredAcr ?? null,
      null,
      input.deviceId ?? null,
      input.subjectId ?? null,
      input.subjectId ?? null,
      input.resolvedUserId ?? null,
      JSON.stringify(ensureJson(input.challengeBinding)),
      JSON.stringify(ensureJson(input.context)),
      JSON.stringify(ensureJson(input.methodState)),
      JSON.stringify(ensureJson(input.result)),
      input.idempotencyKey ?? null,
      input.expiresAt ?? defaultExpiresAt()
    ]
  )

  return mapFlowRow(result.rows[0])
}

export async function getAssuranceFlow(flowId: string, db: Queryable = pool) {
  const result = await db.query<AssuranceFlowRow>('select * from assurance_flows where id = $1', [flowId])
  const row = result.rows[0]
  return row ? mapFlowRow(row) : null
}

export async function getAssuranceFlowByArtifactCode(code: string, db: Queryable = pool) {
  const result = await db.query<AssuranceFlowRow>('select * from assurance_flows where final_artifact_code = $1', [code])
  const row = result.rows[0]
  return row ? mapFlowRow(row) : null
}

export async function updateAssuranceFlow(flowId: string, input: UpdateAssuranceFlowInput, db: Queryable = pool) {
  const current = await getAssuranceFlow(flowId, db)
  if (!current) {
    return null
  }

  const nextStatus = input.status ?? current.status
  if (nextStatus !== current.status) {
    assertAssuranceFlowTransition(current.status, nextStatus)
  }

  const finalizedAt = nextStatus === 'finalized'
    ? (input.finalizedAt ?? current.finalized_at ?? new Date().toISOString())
    : (input.finalizedAt ?? current.finalized_at)

  const result = await db.query<AssuranceFlowRow>(
    `update assurance_flows
     set status = $2,
         current_method = $3,
         requested_acr = $4,
         target_assurance = $5,
         device_id = $6,
         user_hint = $7,
         prospective_user_id = $8,
         resolved_user_id = $9,
         challenge_binding_json = $10::jsonb,
         context_json = $11::jsonb,
         method_state_json = $12::jsonb,
         result_json = $13::jsonb,
         idempotency_key = $14,
         expires_at = $15,
         finalized_at = $16,
         final_artifact_kind = $17,
         final_artifact_code = $18,
         final_artifact_expires_at = $19,
         final_artifact_consumed_at = $20,
         updated_at = now()
     where id = $1
     returning *`,
    [
      flowId,
      nextStatus,
      input.selectedService === undefined ? current.current_method : input.selectedService,
      input.requiredAcr === undefined ? current.requested_acr : input.requiredAcr,
      current.target_assurance,
      input.deviceId === undefined ? current.device_id : input.deviceId,
      input.subjectId === undefined ? current.user_hint : input.subjectId,
      input.subjectId === undefined ? current.prospective_user_id : input.subjectId,
      input.resolvedUserId === undefined ? current.resolved_user_id : input.resolvedUserId,
      JSON.stringify(input.challengeBinding === undefined ? current.challenge_binding_json : ensureJson(input.challengeBinding)),
      JSON.stringify(input.context === undefined ? current.context_json : ensureJson(input.context)),
      JSON.stringify(input.methodState === undefined ? current.method_state_json : ensureJson(input.methodState)),
      JSON.stringify(input.result === undefined ? current.result_json : ensureJson(input.result)),
      input.idempotencyKey === undefined ? current.idempotency_key : input.idempotencyKey,
      input.expiresAt ?? current.expires_at,
      finalizedAt,
      input.finalArtifactKind === undefined ? current.final_artifact_kind : input.finalArtifactKind,
      input.finalArtifactCode === undefined ? current.final_artifact_code : input.finalArtifactCode,
      input.finalArtifactExpiresAt === undefined ? current.final_artifact_expires_at : input.finalArtifactExpiresAt,
      input.finalArtifactConsumedAt === undefined ? current.final_artifact_consumed_at : input.finalArtifactConsumedAt
    ]
  )

  return mapFlowRow(result.rows[0])
}

export async function appendAssuranceFlowEvent(input: FlowEventInput, db: Queryable = pool) {
  const result = await db.query<AssuranceFlowEventRow>(
    `insert into assurance_flow_events (flow_id, event_type, payload_json)
     values ($1, $2, $3::jsonb)
     returning *`,
    [input.flowId, input.eventType, JSON.stringify(ensureJson(input.payload))]
  )

  return result.rows[0]
}

export async function acquireAssuranceFlowFinalizeLock(flowId: string, db: Queryable = pool) {
  const result = await db.query<AssuranceFlowRow>(
    `update assurance_flows
     set finalize_lock_version = finalize_lock_version + 1,
         finalize_locked_at = now(),
         updated_at = now()
     where id = $1
       and status in ('method_verified', 'finalizable', 'finalized')
     returning *`,
    [flowId]
  )

  const row = result.rows[0]
  return row ? mapFlowRow(row) : null
}

export async function listExpiredAssuranceFlows(limit = 100, db: Queryable = pool) {
  const result = await db.query<AssuranceFlowRow>(
    `select * from assurance_flows
     where expires_at <= now()
       and status not in ('finalized', 'expired')
     order by expires_at asc
     limit $1`,
    [limit]
  )

  return result.rows.map(mapFlowRow)
}

export function mapAssuranceFlowRecord(row: AssuranceFlowRow): AssuranceFlowRecord {
  const result = readResult(row)
  return {
    flowId: row.id,
    purpose: row.purpose,
    status: row.status,
    selectedService: row.current_method === 'person_code' || row.current_method === 'sms_tan' ? row.current_method : null,
    availableServices: [],
    requiredAcr: row.requested_acr === 'level_1' || row.requested_acr === 'level_2' ? row.requested_acr : null,
    achievedAcr: result.achievedAcr === 'level_1' || result.achievedAcr === 'level_2' ? result.achievedAcr : null,
    subjectId: row.prospective_user_id ?? row.user_hint,
    resolvedUserId: row.resolved_user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    nextAction: buildNextAction(row.status),
    method: buildMethodSummary(row),
    result: buildResultSummary(row),
    finalization: buildFinalization(row)
  }
}

async function mapPublicAssuranceFlowRecord(row: AssuranceFlowRow, db: Queryable = pool): Promise<PublicAssuranceFlowRecord> {
  const mapped = mapAssuranceFlowRecord(row)
  return {
    ...mapped,
    availableServices: await buildAvailableServices(row, db),
    flowToken: createFlowToken(row.id, row.expires_at)
  }
}

function createServiceSessionId(flowId: string, service: AssuranceFlowService) {
  return `${service}:${flowId}`
}

async function createSelectedServiceResponse(row: AssuranceFlowRow, service: AssuranceFlowService, db: Queryable = pool): Promise<PublicAssuranceFlowRecord> {
  const mapped = await mapPublicAssuranceFlowRecord(row, db)
  return {
    ...mapped,
    serviceToken: createServiceToken(row.id, service, createServiceSessionId(row.id, service), row.expires_at)
  }
}

export async function createPublicAssuranceFlow(input: CreateFlowInput, db: Queryable = pool) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'create_generic_flow',
      userId: input.subjectId ?? null,
      deviceId: input.deviceId ?? null,
      notes: 'Create generic assurance flow.'
    },
    async () => {
      const flow = await createAssuranceFlow({
        purpose: input.purpose,
        requiredAcr: input.requiredAcr ?? 'level_1',
        deviceId: input.deviceId ?? null,
        subjectId: input.subjectId ?? null,
        context: input.context ?? {}
      }, db)
      await appendAssuranceFlowEvent({ flowId: flow.id, eventType: 'flow_created', payload: { purpose: flow.purpose } }, db)
      return mapPublicAssuranceFlowRecord(flow, db)
    }
  )
}

export async function getPublicAssuranceFlow(flowId: string, db: Queryable = pool) {
  const flow = await getAssuranceFlow(flowId, db)
  return flow ? mapPublicAssuranceFlowRecord(flow, db) : null
}

export async function selectPublicAssuranceFlowService(flowId: string, service: AssuranceFlowService, db: Queryable = pool) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'select_flow_service',
      challengeId: flowId,
      notes: 'Select concrete identification service for flow.'
    },
    async () => withTransaction(async (client) => {
      const flow = await getAssuranceFlow(flowId, client)
      if (!flow) {
        throw notFound('Unknown flow')
      }
      if (flow.status !== 'started') {
        throw badRequest('Flow is not ready for service selection')
      }

      const availableServices = await buildAvailableServices(flow, client)
      if (!availableServices.some((entry) => entry.id === service)) {
        throw badRequest('Requested service is not available for this flow')
      }

      const updated = await updateAssuranceFlow(flow.id, {
        status: 'method_in_progress',
        selectedService: service,
        methodState: {
          ...readMethodState(flow),
          service,
          method: assuranceServiceRegistry[service].method
        }
      }, client)
      if (!updated) {
        throw notFound('Unknown flow')
      }

      await appendAssuranceFlowEvent({ flowId, eventType: 'flow_service_selected', payload: { service } }, client)
      return createSelectedServiceResponse(updated, service, client)
    })
  )
}

export async function startPublicAssuranceFlowMethod(flowId: string, method: AssuranceFlowMethod, input: { payload?: JsonObject }, db: Queryable = pool) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'start_generic_flow_method',
      challengeId: flowId,
      notes: 'Start generic assurance flow method.'
    },
    async () => {
  const record = await withTransaction(async (client) => {
        const flow = await getAssuranceFlow(flowId, client)
        if (!flow) {
          throw notFound('Unknown flow')
        }
        if (flow.status !== 'method_in_progress') {
          throw badRequest('Flow cannot start a method in the current state')
        }

        let result: MethodStartResult
        const payload = asJsonObject(input.payload)
        switch (method) {
          case 'code': {
            if (flow.purpose !== 'registration') {
              throw badRequest('Method code is only supported for registration flows')
            }
            if (payload.service !== 'person_code') {
              throw badRequest('Method code requires service person_code')
            }
            const methodState: FlowMethodState = {
              method: 'code',
              service: 'person_code',
              state: 'challenge_sent',
              verifiedAt: undefined,
              deviceName: typeof readContext(flow).deviceName === 'string' ? String(readContext(flow).deviceName) : undefined,
              publicKey: typeof readContext(flow).publicKey === 'string' ? String(readContext(flow).publicKey) : undefined
            }
            const row = await updateAssuranceFlow(flow.id, {
              status: 'method_in_progress',
              selectedService: 'person_code',
              methodState,
              result: { assurance: [] }
            }, client)
            if (!row) {
              throw notFound('Unknown flow')
            }
            result = { row, eventType: 'flow_method_started_code' }
            break
          }
          case 'sms': {
            if (flow.purpose === 'registration' && payload.service !== 'sms_tan') {
              throw badRequest('Registration SMS requires service sms_tan')
            }
            const target = flow.purpose === 'registration'
              ? (await getRegistrationSmsNumberForFlow(flow, client)).smsNumber.phone_number
              : (typeof payload.target === 'string'
                  ? payload.target.trim()
                  : (typeof readContext(flow).phoneNumber === 'string'
                      ? String(readContext(flow).phoneNumber).trim()
                      : (flow.prospective_user_id ?? flow.user_hint)
                        ? ((await getSmsNumberByUserId(flow.prospective_user_id ?? flow.user_hint ?? '', client))?.phone_number ?? '')
                        : ''))
            if (!target) {
              throw badRequest('SMS target is required')
            }
            const code = generateSmsCode()
            const methodState: FlowMethodState = {
              method: 'sms',
              service: flow.purpose === 'registration' ? 'sms_tan' : undefined,
              state: 'challenge_sent',
              target,
              maskedTarget: maskPhone(target),
              code
            }
            const row = await updateAssuranceFlow(flow.id, {
              status: 'method_in_progress',
              selectedService: 'sms_tan',
              methodState,
              result: { assurance: [] }
            }, client)
            if (!row) {
              throw notFound('Unknown flow')
            }
            result = { row, eventType: 'flow_method_started_sms' }
            break
          }
        }

        await appendAssuranceFlowEvent({
          flowId,
          eventType: result.eventType,
          payload: {
            method,
            methodState: readMethodState(result.row)
          }
        }, client)
        return {
          status: 'challenge_sent' as const,
          maskedTarget: readMethodState(result.row).maskedTarget ?? null,
          devCode: readMethodState(result.row).code ?? null
        }
      })

      return record
    }
  )
}

export async function completePublicAssuranceFlowMethod(flowId: string, method: AssuranceFlowMethod, input: { payload?: JsonObject }, db: Queryable = pool) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'complete_generic_flow_method',
      challengeId: flowId,
      notes: 'Complete generic assurance flow method.'
    },
    async () => {
      const record = await withTransaction(async (client) => {
        const flow = await getAssuranceFlow(flowId, client)
        if (!flow) {
          throw notFound('Unknown flow')
        }
        if (flow.status !== 'method_in_progress') {
          throw badRequest('Flow is not waiting for method completion')
        }

        const payload = asJsonObject(input.payload)
        const methodState = readMethodState(flow)
        if (methodState.method !== method) {
          throw badRequest('Requested method does not match active flow method')
        }

        let result: MethodCompleteResult
        switch (method) {
          case 'code': {
            const service = methodState.service ?? readIdentityService(flow)
            if (service !== 'person_code') {
              throw badRequest('Active code flow does not use service person_code')
            }
            const codeIdentity = await getRegistrationPersonCodeForInput(payload, flow, client)
            const providedCode = typeof payload.code === 'string' ? payload.code.trim() : ''
            if (!providedCode || providedCode !== codeIdentity.code.code) {
              throw badRequest('Invalid verification code')
            }
            const verifiedAt = new Date().toISOString()
            const nextMethodState = await ensureRegistrationDeviceState(flow, client)
            nextMethodState.service = 'person_code'
            nextMethodState.personCodeId = codeIdentity.code.id
            nextMethodState.verifiedAt = verifiedAt
            const row = await updateAssuranceFlow(flow.id, {
              status: 'finalizable',
              selectedService: 'person_code',
              methodState: nextMethodState,
              result: {
                assurance: ['activation_code_verified'],
                achievedAcr: 'level_2',
                amr: ['code'],
                authTime: verifiedAt,
                verifiedAt
              }
            }, client)
            if (!row) {
              throw notFound('Unknown flow')
            }
            result = { row, eventType: 'flow_method_completed_code' }
            break
          }
          case 'sms': {
            const providedCode = typeof payload.tan === 'string' ? payload.tan.trim() : (typeof payload.code === 'string' ? payload.code.trim() : '')
            if (!providedCode || providedCode !== methodState.code) {
              throw badRequest('Invalid SMS code')
            }
            const verifiedAt = new Date().toISOString()
            const row = await updateAssuranceFlow(flow.id, {
              status: 'finalizable',
              selectedService: 'sms_tan',
              methodState: {
                ...methodState,
                state: 'challenge_verified',
                verifiedAt
              },
              result: {
                assurance: [flow.purpose === 'registration' ? 'registration_identity_verified' : 'phone_verified'],
                achievedAcr: 'level_2',
                amr: ['sms'],
                authTime: verifiedAt
              }
            }, client)
            if (!row) {
              throw notFound('Unknown flow')
            }
            result = { row, eventType: 'flow_method_completed_sms' }
            break
          }
        }

        await appendAssuranceFlowEvent({ flowId, eventType: result.eventType, payload: { method } }, client)
        const finalizedMethodState = readMethodState(result.row)
        const resultState = readResult(result.row)
        const service = finalizedMethodState.service ?? (method === 'code' ? 'person_code' : 'sms_tan')
        return {
          status: 'verified' as const,
          achievedAcr: resultState.achievedAcr === 'level_1' || resultState.achievedAcr === 'level_2' ? resultState.achievedAcr : 'level_2',
          serviceResultToken: createServiceResultToken(
            result.row.id,
            service,
            createServiceSessionId(result.row.id, service),
            resultState.achievedAcr === 'level_1' || resultState.achievedAcr === 'level_2' ? resultState.achievedAcr : 'level_2',
            result.row.expires_at
          )
        }
      })

      return record
    }
  )
}

export async function finalizePublicAssuranceFlow(flowId: string, input: { serviceResultToken?: string; channel?: FinalizeFlowChannel }, db: Queryable = pool) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'finalize_generic_flow',
      challengeId: flowId,
      notes: 'Finalize generic assurance flow.'
    },
    async () => {
      const record = await withTransaction(async (client) => {
        const locked = await acquireAssuranceFlowFinalizeLock(flowId, client)
        if (!locked) {
          throw badRequest('Flow is not ready to finalize')
        }

        const current = await getAssuranceFlow(flowId, client)
        if (!current) {
          throw notFound('Unknown flow')
        }

        if (!input.serviceResultToken) {
          throw badRequest('Missing service result token')
        }
        const serviceResult = verifyServiceResultToken(input.serviceResultToken, flowId)
        if (!serviceResult.ok) {
          throw badRequest('Invalid service result token')
        }
        const requiredAcr = current.requested_acr === 'level_1' || current.requested_acr === 'level_2' ? current.requested_acr : 'level_1'
        const achievedAcr = serviceResult.claims.achievedAcr === 'level_1' || serviceResult.claims.achievedAcr === 'level_2' ? serviceResult.claims.achievedAcr : null
        if (!achievedAcr || !satisfiesRequiredAcr(achievedAcr, requiredAcr)) {
          throw badRequest('Service result does not satisfy required ACR')
        }

        const updatedCurrent = await updateAssuranceFlow(flowId, {
          result: {
            ...readResult(current),
            achievedAcr
          }
        }, client)
        if (!updatedCurrent) {
          throw notFound('Unknown flow')
        }

        let result: FinalizeResult
        if (updatedCurrent.purpose === 'registration') {
          result = await finalizeRegistration(updatedCurrent, client)
        } else {
          result = await finalizeStepUp(updatedCurrent, input.channel ?? 'registration', client)
        }

        await appendAssuranceFlowEvent({ flowId, eventType: result.eventType, payload: { channel: input.channel ?? 'registration' } }, client)
        return mapPublicAssuranceFlowRecord(result.row, client)
      })

      return record
    }
  )
}

export async function redeemFlowArtifact(code: string, expectedKind: 'assurance_handle' | 'result_code', db: Queryable = pool): Promise<RedeemFlowArtifactResponse> {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'redeem_flow_artifact',
      notes: 'Redeem assurance handle or browser result code.'
    },
    async () => withTransaction(async (client) => {
      const flow = await getAssuranceFlowByArtifactCode(code, client)
      if (!flow) {
        throw notFound('Unknown flow artifact')
      }
      if (flow.final_artifact_kind !== expectedKind) {
        throw badRequest('Unexpected flow artifact kind')
      }
      if (flow.final_artifact_consumed_at) {
        throw badRequest('Flow artifact already used')
      }
      if (!flow.final_artifact_expires_at || new Date(flow.final_artifact_expires_at).getTime() < Date.now()) {
        throw badRequest('Flow artifact expired')
      }

      const result = readResult(flow)
      const userId = flow.resolved_user_id ?? flow.prospective_user_id ?? flow.user_hint
      if (!userId) {
        throw badRequest('Flow has no resolved subject')
      }

      const updated = await updateAssuranceFlow(flow.id, {
        finalArtifactConsumedAt: new Date().toISOString(),
        resolvedUserId: userId,
        result: {
          ...result,
          userId
        }
      }, client)
      if (!updated) {
        throw notFound('Unknown flow')
      }

      await appendAssuranceFlowEvent({ flowId: flow.id, eventType: 'flow_artifact_redeemed', payload: { expectedKind } }, client)
      return {
        flowId: flow.id,
        userId,
        purpose: flow.purpose,
        achievedAcr: typeof result.achievedAcr === 'string' ? result.achievedAcr : flow.requested_acr,
        amr: Array.isArray(result.amr) ? result.amr.filter((entry): entry is string => typeof entry === 'string') : [],
        authTime: typeof result.authTime === 'string' ? result.authTime : new Date().toISOString()
      }
    })
  )
}

export async function registerDeviceViaFlow(args: {
  userId: string
  firstName: string
  lastName: string
  birthDate: string
  deviceName: string
  identityService: AssuranceFlowService
  identityInput?: JsonObject
  publicKey: string
}) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'register_device_via_flow',
      userId: args.userId,
      notes: 'Register device through the generic flow engine.'
    },
    async () => {
      const created = await createPublicAssuranceFlow({
        purpose: 'registration',
        subjectId: args.userId,
        context: {
          firstName: args.firstName,
          lastName: args.lastName,
          birthDate: args.birthDate,
          identityService: args.identityService,
          identityInput: args.identityInput ?? {},
          deviceName: args.deviceName,
          publicKey: args.publicKey
        }
      })
      if (args.identityService === 'sms_tan') {
        throw badRequest('Legacy device registration does not support sms_tan; use the flow endpoints for multi-step registration')
      }
      await selectPublicAssuranceFlowService(created.flowId, 'person_code')
      await startPublicAssuranceFlowMethod(created.flowId, 'code', {
        payload: {
          service: 'person_code'
        }
      })
      const completed = await completePublicAssuranceFlowMethod(created.flowId, 'code', {
        payload: {
          code: typeof args.identityInput?.code === 'string' ? args.identityInput.code : undefined
        }
      })
      const finalized = await finalizePublicAssuranceFlow(created.flowId, { serviceResultToken: completed.serviceResultToken, channel: 'registration' })
      if (!finalized.finalization || finalized.finalization.kind !== 'registration_result') {
        throw badRequest('Registration flow did not return a registration result')
      }
      const storedFlow = await getAssuranceFlow(created.flowId)
      if (!storedFlow) {
        throw notFound('Unknown flow')
      }
      const result = readResult(storedFlow)
      return {
        deviceId: typeof result.deviceId === 'string' ? result.deviceId : created.flowId,
        deviceName: args.deviceName,
        publicKeyHash: typeof result.publicKeyHash === 'string' ? result.publicKeyHash : hashPublicKey(args.publicKey),
        passwordRequired: finalized.finalization.passwordSetupRequired
      }
    }
  )
}

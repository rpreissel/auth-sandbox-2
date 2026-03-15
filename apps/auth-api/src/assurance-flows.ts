import { randomInt, randomUUID } from 'node:crypto'

import { appConfig, logger, pool, runWithSpan, withTransaction } from '@auth-sandbox-2/backend-core'
import type {
  AssuranceFlowFinalization,
  AssuranceFlowMethod,
  AssuranceFlowMethodSummary,
  AssuranceFlowNextAction,
  AssuranceFlowRecord,
  CreateFlowResponse,
  AssuranceFlowResultSummary,
  CompleteFlowMethodInput,
  CreateFlowInput,
  FinalizeFlowChannel,
  FinalizeFlowResponse,
  GetFlowResponse,
  RedeemFlowArtifactResponse,
  StartFlowMethodResponse,
  StartFlowMethodInput
} from '@auth-sandbox-2/shared-types'

import { createEncryptedChallenge, generateEncryptionKeyPair, hashPublicKey } from './lib/crypto.js'
import { createFlowToken } from './flow-tokens.js'
import { KeycloakAdminClient } from './keycloak.js'
import type {
  AssuranceFlowEventRow,
  AssuranceFlowJson,
  AssuranceFlowPurpose,
  AssuranceFlowRow,
  AssuranceFlowStatus,
  DeviceRow,
  RegistrationCodeRow
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
  requestedAcr?: string | null
  targetAssurance?: string | null
  deviceId?: string | null
  userHint?: string | null
  prospectiveUserId?: string | null
  resolvedUserId?: string | null
  currentMethod?: string | null
  challengeBinding?: AssuranceFlowJson
  context?: AssuranceFlowJson
  methodState?: AssuranceFlowJson
  result?: AssuranceFlowJson
  idempotencyKey?: string | null
  expiresAt?: string
}

export type UpdateAssuranceFlowInput = {
  status?: AssuranceFlowStatus
  currentMethod?: string | null
  requestedAcr?: string | null
  targetAssurance?: string | null
  deviceId?: string | null
  userHint?: string | null
  prospectiveUserId?: string | null
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
  state?: string
  target?: string
  maskedTarget?: string
  code?: string
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
      return 'start_method'
    case 'method_in_progress':
      return 'complete_method'
    case 'method_verified':
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

function buildResultSummary(row: AssuranceFlowRow): AssuranceFlowResultSummary | null {
  const result = readResult(row)
  const assurance = Array.isArray(result.assurance)
    ? result.assurance.filter((entry): entry is string => typeof entry === 'string')
    : []
  return assurance.length ? { assurance } : null
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
  const registrationCode = await getRegistrationCodeForFlow(flow, db)
  const methodState = await ensureRegistrationDeviceState(flow, db)
  const userId = flow.prospective_user_id ?? flow.user_hint
  const deviceName = methodState.deviceName
  const publicKey = methodState.publicKey
  const publicKeyHash = methodState.publicKeyHash

  if (!userId || !deviceName || !publicKey || !publicKeyHash) {
    throw badRequest('Registration flow is missing device material')
  }

  const displayName = registrationCode.display_name ?? undefined
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

  await db.query('update registration_codes set use_count = use_count + 1 where id = $1', [registrationCode.id])
  const passwordSetupRequired = !(await adminClient.hasPassword(userId))
  const nextResult = {
    assurance: ['device_registered'],
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
      achievedAcr: result.achievedAcr ?? current.requested_acr ?? current.target_assurance ?? null,
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
      input.currentMethod ?? null,
      input.requestedAcr ?? null,
      input.targetAssurance ?? null,
      input.deviceId ?? null,
      input.userHint ?? null,
      input.prospectiveUserId ?? null,
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
      input.currentMethod === undefined ? current.current_method : input.currentMethod,
      input.requestedAcr === undefined ? current.requested_acr : input.requestedAcr,
      input.targetAssurance === undefined ? current.target_assurance : input.targetAssurance,
      input.deviceId === undefined ? current.device_id : input.deviceId,
      input.userHint === undefined ? current.user_hint : input.userHint,
      input.prospectiveUserId === undefined ? current.prospective_user_id : input.prospectiveUserId,
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
  return {
    flowId: row.id,
    purpose: row.purpose,
    status: row.status,
    currentMethod: row.current_method,
    requestedAcr: row.requested_acr,
    targetAssurance: row.target_assurance,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    nextAction: buildNextAction(row.status),
    method: buildMethodSummary(row),
    result: buildResultSummary(row),
    finalization: buildFinalization(row)
  }
}

function mapPublicAssuranceFlowRecord(row: AssuranceFlowRow): CreateFlowResponse | GetFlowResponse | StartFlowMethodResponse | FinalizeFlowResponse {
  return {
    ...mapAssuranceFlowRecord(row),
    flowToken: createFlowToken(row.id, row.expires_at)
  }
}

export async function createPublicAssuranceFlow(input: CreateFlowInput, db: Queryable = pool) {
  return runWithSpan(
    {
      kind: 'process',
      actorType: 'backend',
      actorName: 'auth-api',
      operation: 'create_generic_flow',
      userId: input.prospectiveUserId ?? input.userHint ?? null,
      deviceId: input.deviceId ?? null,
      notes: 'Create generic assurance flow.'
    },
    async () => {
      const flow = await createAssuranceFlow({
        purpose: input.purpose,
        requestedAcr: input.requestedAcr ?? null,
        targetAssurance: input.targetAssurance ?? null,
        deviceId: input.deviceId ?? null,
        userHint: input.userHint ?? null,
        prospectiveUserId: input.prospectiveUserId ?? null,
        context: input.context ?? {}
      }, db)
      await appendAssuranceFlowEvent({ flowId: flow.id, eventType: 'flow_created', payload: { purpose: flow.purpose } }, db)
      return mapPublicAssuranceFlowRecord(flow)
    }
  )
}

export async function getPublicAssuranceFlow(flowId: string, db: Queryable = pool) {
  const flow = await getAssuranceFlow(flowId, db)
  return flow ? mapPublicAssuranceFlowRecord(flow) : null
}

export async function startPublicAssuranceFlowMethod(flowId: string, method: AssuranceFlowMethod, input: StartFlowMethodInput, db: Queryable = pool) {
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
        if (flow.status !== 'started' && flow.status !== 'method_in_progress') {
          throw badRequest('Flow cannot start a method in the current state')
        }

        let result: MethodStartResult
        const payload = asJsonObject(input.payload)
        switch (method) {
          case 'code': {
            if (flow.purpose !== 'registration') {
              throw badRequest('Method code is only supported for registration flows')
            }
            const registrationCode = await getRegistrationCodeForFlow(flow, client)
            const methodState: FlowMethodState = {
              method: 'code',
              state: 'challenge_sent',
              code: registrationCode.code,
              verifiedAt: undefined,
              deviceName: typeof readContext(flow).deviceName === 'string' ? String(readContext(flow).deviceName) : undefined,
              publicKey: typeof readContext(flow).publicKey === 'string' ? String(readContext(flow).publicKey) : undefined
            }
            const row = await updateAssuranceFlow(flow.id, {
              status: 'method_in_progress',
              currentMethod: 'code',
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
            const target = typeof payload.target === 'string' ? payload.target.trim() : ''
            if (!target) {
              throw badRequest('SMS target is required')
            }
            const code = generateSmsCode()
            const methodState: FlowMethodState = {
              method: 'sms',
              state: 'challenge_sent',
              target,
              maskedTarget: maskPhone(target),
              code
            }
            const row = await updateAssuranceFlow(flow.id, {
              status: 'method_in_progress',
              currentMethod: 'sms',
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
        return mapPublicAssuranceFlowRecord(result.row)
      })

      return record
    }
  )
}

export async function completePublicAssuranceFlowMethod(flowId: string, method: AssuranceFlowMethod, input: CompleteFlowMethodInput, db: Queryable = pool) {
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
            const providedCode = typeof payload.code === 'string' ? payload.code.trim() : ''
            if (!providedCode || providedCode !== methodState.code) {
              throw badRequest('Invalid verification code')
            }
            const verifiedAt = new Date().toISOString()
            const nextMethodState = await ensureRegistrationDeviceState(flow, client)
            nextMethodState.verifiedAt = verifiedAt
            const row = await updateAssuranceFlow(flow.id, {
              status: 'finalizable',
              currentMethod: 'code',
              methodState: nextMethodState,
              result: {
                assurance: ['activation_code_verified'],
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
            const providedCode = typeof payload.code === 'string' ? payload.code.trim() : ''
            if (!providedCode || providedCode !== methodState.code) {
              throw badRequest('Invalid SMS code')
            }
            const verifiedAt = new Date().toISOString()
            const row = await updateAssuranceFlow(flow.id, {
              status: 'finalizable',
              currentMethod: 'sms',
              methodState: {
                ...methodState,
                state: 'challenge_verified',
                verifiedAt
              },
              result: {
                assurance: ['phone_verified'],
                achievedAcr: flow.requested_acr ?? flow.target_assurance ?? 'urn:auth-sandbox-2:acr:sms',
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
        return mapPublicAssuranceFlowRecord(result.row)
      })

      return record
    }
  )
}

export async function finalizePublicAssuranceFlow(flowId: string, channel: FinalizeFlowChannel = 'registration', db: Queryable = pool) {
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

        let result: FinalizeResult
        if (current.purpose === 'registration') {
          result = await finalizeRegistration(current, client)
        } else {
          result = await finalizeStepUp(current, channel, client)
        }

        await appendAssuranceFlowEvent({ flowId, eventType: result.eventType, payload: { channel } }, client)
        return mapPublicAssuranceFlowRecord(result.row)
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
  deviceName: string
  activationCode: string
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
        userHint: args.userId,
        prospectiveUserId: args.userId,
        context: {
          activationCode: args.activationCode,
          deviceName: args.deviceName,
          publicKey: args.publicKey
        }
      })
      await startPublicAssuranceFlowMethod(created.flowId, 'code', {})
      await completePublicAssuranceFlowMethod(created.flowId, 'code', {
        payload: {
          code: args.activationCode
        }
      })
      const finalized = await finalizePublicAssuranceFlow(created.flowId, 'registration')
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

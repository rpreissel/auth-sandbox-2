import { randomUUID } from 'node:crypto'

import { pool, withTransaction } from '@auth-sandbox-2/backend-core'

import type { CreateTanMockAdminRecordInput, JsonObject, TanMockAdminOverview, TanMockAdminRecord, TanMockSessionSummary } from '@auth-sandbox-2/shared-types'

type ClaimsRow = {
  broker_username: string
  source_user_id: string
  claims_json: JsonObject
}

function mapAdminRecord(row: {
  id: string
  tan: string
  user_id: string
  source_user_id: string
  active: boolean
  consumed_at: string | null
  created_at: string
}): TanMockAdminRecord {
  return {
    id: row.id,
    tan: row.tan,
    userId: row.user_id,
    sourceUserId: row.source_user_id,
    active: row.active,
    consumedAt: row.consumed_at,
    createdAt: row.created_at
  }
}

export async function listOverview(): Promise<TanMockAdminOverview> {
  const [entriesResult, sessionsResult] = await Promise.all([
    pool.query(`
      select id, tan, user_id, source_user_id, active, consumed_at::text, created_at::text
      from tanmock_entries
      order by created_at desc
    `),
    pool.query(`
      select code as authorization_code, client_id, redirect_uri, scope, created_at::text
      from tanmock_authorization_codes
      where expires_at > now() and used = false
      order by created_at desc
      limit 10
    `)
  ])

  return {
    entries: entriesResult.rows.map(mapAdminRecord),
    sessions: sessionsResult.rows.map((row) => ({
      authorizationCode: row.authorization_code,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      scope: row.scope,
      createdAt: row.created_at
    } satisfies TanMockSessionSummary))
  }
}

export async function createEntry(input: CreateTanMockAdminRecordInput) {
  const result = await pool.query(`
    insert into tanmock_entries (tan, user_id, source_user_id)
    values ($1, $2, $3)
    returning id, tan, user_id, source_user_id, active, consumed_at::text, created_at::text
  `, [input.tan, input.userId, input.sourceUserId])

  return mapAdminRecord(result.rows[0])
}

export async function consumeActiveTan(tan: string) {
  return withTransaction(async (client) => {
    const result = await client.query(`
      select id, tan, user_id, source_user_id, active, consumed_at::text, created_at::text
      from tanmock_entries
      where tan = $1 and active = true and consumed_at is null
      for update
    `, [tan])

    const row = result.rows[0]
    if (!row) {
      return null
    }

    await client.query(`
      update tanmock_entries
      set consumed_at = now(), active = false
      where id = $1
    `, [row.id])

    return mapAdminRecord({
      ...row,
      active: false,
      consumed_at: new Date().toISOString()
    })
  })
}

export async function createAuthorizationCode(args: {
  clientId: string
  redirectUri: string
  scope: string
  state?: string | null
  nonce?: string | null
  codeChallenge?: string | null
  codeChallengeMethod?: string | null
  brokerUsername: string
  sourceUserId: string
  claims: JsonObject
  expiresAt: Date
}) {
  const code = randomUUID()
  await pool.query(`
    insert into tanmock_authorization_codes (
      code, client_id, redirect_uri, scope, state, nonce, code_challenge,
      code_challenge_method, broker_username, source_user_id, claims_json, expires_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    code,
    args.clientId,
    args.redirectUri,
    args.scope,
    args.state ?? null,
    args.nonce ?? null,
    args.codeChallenge ?? null,
    args.codeChallengeMethod ?? null,
    args.brokerUsername,
    args.sourceUserId,
    JSON.stringify(args.claims),
    args.expiresAt.toISOString()
  ])

  return code
}

export async function useAuthorizationCode(code: string) {
  return withTransaction(async (client) => {
    const result = await client.query<ClaimsRow & {
      code: string
      client_id: string
      redirect_uri: string
      scope: string
      nonce: string | null
      code_challenge: string | null
      code_challenge_method: string | null
      expires_at: string
      used: boolean
    }>(`
      select code, client_id, redirect_uri, scope, nonce, code_challenge, code_challenge_method, broker_username, source_user_id, claims_json, expires_at::text, used
      from tanmock_authorization_codes
      where code = $1
      for update
    `, [code])

    const row = result.rows[0]
    if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) {
      return null
    }

    await client.query('update tanmock_authorization_codes set used = true where code = $1', [code])
    return row
  })
}

export async function createRefreshToken(args: {
  brokerUsername: string
  sourceUserId: string
  claims: JsonObject
  expiresAt: Date
}) {
  const refreshToken = randomUUID()
  await pool.query(`
    insert into tanmock_refresh_tokens (refresh_token, broker_username, source_user_id, claims_json, expires_at)
    values ($1, $2, $3, $4, $5)
  `, [refreshToken, args.brokerUsername, args.sourceUserId, JSON.stringify(args.claims), args.expiresAt.toISOString()])

  return refreshToken
}

export async function useRefreshToken(refreshToken: string) {
  return withTransaction(async (client) => {
    const result = await client.query<ClaimsRow & {
      refresh_token: string
      expires_at: string
      used: boolean
    }>(`
      select refresh_token, broker_username, source_user_id, claims_json, expires_at::text, used
      from tanmock_refresh_tokens
      where refresh_token = $1
      for update
    `, [refreshToken])

    const row = result.rows[0]
    if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) {
      return null
    }

    await client.query('update tanmock_refresh_tokens set used = true where refresh_token = $1', [refreshToken])
    return row
  })
}

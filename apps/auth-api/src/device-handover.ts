import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { pool } from '@auth-sandbox-2/backend-core'

export function generateHandoverSecret() {
  return randomBytes(32).toString('base64url')
}

export async function getUserHandoverSecret(userId: string): Promise<string> {
  const result = await pool.query<{ handover_secret: string }>(
    'select handover_secret from user where user_id = $1',
    [userId]
  )
  const row = result.rows[0]
  if (!row || !row.handover_secret) {
    const secret = generateHandoverSecret()
    await pool.query(
      'update user set handover_secret = $1 where user_id = $2',
      [secret, userId]
    )
    return secret
  }
  return row.handover_secret
}

export async function ensureUserHandoverSecret(userId: string): Promise<string> {
  const result = await pool.query<{ handover_secret: string }>(
    'select handover_secret from user where user_id = $1',
    [userId]
  )
  const row = result.rows[0]
  if (row?.handover_secret) {
    return row.handover_secret
  }
  const secret = generateHandoverSecret()
  await pool.query(
    'update user set handover_secret = $1 where user_id = $2',
    [secret, userId]
  )
  return secret
}

export function createHandoverEnvelope(input: {
  userHandoverSecret: string
  userId: string
  publicKeyHash: string
  nonce: string
  exp: number
  jti: string
  acr?: string | null
}) {
  const secretBytes = Buffer.from(input.userHandoverSecret, 'base64url')
  const iv = randomBytes(12)

  const innerPayload = JSON.stringify({
    type: 'device',
    sub: input.userId,
    publicKeyHash: input.publicKeyHash,
    exp: input.exp,
    jti: input.jti,
    nonce: input.nonce,
    acr: input.acr ?? null
  })

  const cipher = createCipheriv('aes-256-gcm', secretBytes, iv)
  const encrypted = Buffer.concat([
    cipher.update(innerPayload, 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ])

  return {
    handoverIv: iv.toString('base64url'),
    handoverCiphertext: encrypted.toString('base64url')
  }
}

export function createDeviceHandoverProof(input: {
  userHandoverSecret: string
  userId: string
  publicKeyHash: string
  nonce: string
  exp: number
  jti: string
  acr?: string | null
}) {
  const innerPayload = JSON.stringify({
    type: 'device',
    sub: input.userId,
    publicKeyHash: input.publicKeyHash,
    exp: input.exp,
    jti: input.jti,
    nonce: input.nonce,
    acr: input.acr ?? null
  })
  return innerPayload
}
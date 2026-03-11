import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  sign,
  verify
} from 'node:crypto'

export function hashPublicKey(publicKeyPem: string) {
  return createHash('sha256').update(publicKeyPem).digest('hex')
}

export function generateEncryptionKeyPair() {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

  return {
    publicKeyPem: pair.publicKey,
    privateKeyPem: pair.privateKey
  }
}

export function createEncryptedChallenge(payload: object, encryptionPublicKeyPem: string) {
  const iv = randomBytes(12)
  const aesKey = randomBytes(32)

  const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
  const encryptedData = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final(), cipher.getAuthTag()])

  const encryptedKey = publicEncrypt(
    {
      key: createPublicKey(encryptionPublicKeyPem),
      oaepHash: 'sha256'
    },
    aesKey
  )

  return {
    encryptedKey: encryptedKey.toString('base64'),
    encryptedData: encryptedData.toString('base64'),
    iv: iv.toString('base64')
  }
}

export function decryptChallenge(encryptedKey: string, encryptedData: string, iv: string, privateKeyPem: string) {
  const aesKey = privateDecrypt(
    {
      key: createPrivateKey(privateKeyPem),
      oaepHash: 'sha256'
    },
    Buffer.from(encryptedKey, 'base64')
  )

  const source = Buffer.from(encryptedData, 'base64')
  const authTag = source.subarray(source.length - 16)
  const ciphertext = source.subarray(0, source.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(authTag)

  const payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(payload) as { exp: number; nonce: string; userId: string }
}

export function signPayload(payload: string, privateKeyPem: string) {
  return sign('RSA-SHA256', Buffer.from(payload, 'utf8'), privateKeyPem).toString('base64')
}

export function verifyPayloadSignature(payload: string, signature: string, publicKeyPem: string) {
  return verify('RSA-SHA256', Buffer.from(payload, 'utf8'), publicKeyPem, Buffer.from(signature, 'base64'))
}

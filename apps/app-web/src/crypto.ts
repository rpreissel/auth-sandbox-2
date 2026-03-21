async function exportPublicKey(publicKey: CryptoKey) {
  const exported = await crypto.subtle.exportKey('spki', publicKey)
  const body = btoa(String.fromCharCode(...new Uint8Array(exported)))
  const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? body
  return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`
}

async function exportPrivateKey(privateKey: CryptoKey) {
  const exported = await crypto.subtle.exportKey('pkcs8', privateKey)
  return btoa(String.fromCharCode(...new Uint8Array(exported)))
}

function base64ToArrayBuffer(value: string) {
  const raw = atob(value)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0)).buffer
}

export async function createSigningKeys() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  )

  const publicKey = await exportPublicKey(pair.publicKey)
  return {
    publicKey,
    privateKey: pair.privateKey
  }
}

export async function importPrivateKey(serializedKey: string) {
  return crypto.subtle.importKey(
    'pkcs8',
    base64ToArrayBuffer(serializedKey),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    true,
    ['sign']
  )
}

export { exportPrivateKey }

export async function signEncryptedData(encryptedData: string, privateKey: CryptoKey) {
  const payload = Uint8Array.from(atob(encryptedData), (char) => char.charCodeAt(0))
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, payload)
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

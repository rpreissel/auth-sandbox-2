import { randomBytes } from 'node:crypto'

export function generateActivationCode() {
  return randomBytes(4).toString('hex').toUpperCase()
}

export function generatePassword() {
  return `Init-${randomBytes(8).toString('base64url')}`
}

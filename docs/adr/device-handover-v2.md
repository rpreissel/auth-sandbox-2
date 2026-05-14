# Device Handover v2 — Payload Format and Cryptographic Contract

## Status

Normative — this document is the authoritative source for the handover-v2 protocol.

## Overview

handover-v2 replaces the HMAC-only `handoverProof` field with an AES-256-GCM encrypted envelope. The envelope uses the **persistent per-user Handover Secret** stored in Postgres as the 32-byte symmetric key. The design provides both **confidentiality** (payload is encrypted) and **integrity** (GCM auth tag). Keycloak decrypts the payload, validates the auth tag, then cross-checks the plaintext values against the outer fields.

---

## Cryptographic Primitives

- **Cipher**: AES-256-GCM
- **IV**: 12 random bytes, generated fresh per login token
- **Key**: 32-byte secret from Postgres `user.handover_secret`
- **Auth tag**: 16 bytes, appended to ciphertext (automatically produced by `createCipheriv`)
- **KDF**: None — the per-user secret is used directly as the AES key

---

## login_token Structure (Outer / Cleartext)

The `login_token` is a base64url-encoded JSON object. All fields below are **visible in cleartext** before Keycloak decryption.

```json
{
  "type": "device",
  "sub": "<userId>",
  "publicKeyHash": "<hex>",
  "exp": 1234567890,
  "jti": "<uuid>",
  "acr": "level_1",
  "handoverIv": "<base64url>",
  "handoverCiphertext": "<base64url>"
}
```

| Field | Description |
|-------|-------------|
| `type` | Always `"device"` for device-login grants |
| `sub` | Keycloak user ID (maps to the one user credential) |
| `publicKeyHash` | The active binding's public key hash; Keycloak uses this to find the right credential |
| `exp` | Unix timestamp (seconds) when this token expires; must be validated before replay check |
| `jti` | Unique token ID (UUID); used for replay detection in Keycloak |
| `acr` | Requested ACR level (optional, e.g. `"level_1"`) |
| `handoverIv` | 12-byte random IV, base64url-encoded |
| `handoverCiphertext` | AES-256-GCM ciphertext, base64url-encoded, includes 16-byte auth tag |

---

## Encrypted Payload (Inner)

Decrypted by Keycloak using `handoverCiphertext` and `handoverIv` with the per-user secret. Must contain at minimum:

```json
{
  "type": "device",
  "sub": "<userId>",
  "publicKeyHash": "<hex>",
  "exp": 1234567890,
  "jti": "<uuid>",
  "nonce": "<uuid from challenge>",
  "acr": "level_1"
}
```

These values are **duplicated** inside the encrypted payload. Keycloak's validation flow:

1. Parse outer `login_token`
2. Locate the single `device-login` credential for `sub`
3. Extract `publicKeyHash` from outer — find matching binding entry **inside** that one credential's `credentialData`
4. Read per-user `handoverSecret` from `secretData`
5. Decrypt `handoverCiphertext` with `handoverIv` + secret — validate GCM auth tag
6. Parse inner payload; for each field, compare with the corresponding outer field
7. Reject if any mismatch
8. Accept login only if all cross-checks pass

---

## Versioning

| Version | Status | Description |
|---------|--------|-------------|
| `handover-v1` | Deprecated | HMAC-only proof; `deriveUserDeviceHandoverSecret` from global env |
| `handover-v2` | **Current** | AES-256-GCM encrypted envelope; persistent per-user secret |

The version field inside `credentialData` determines which validation path Keycloak uses.

---

## Migration Note

- Auth-api must produce only `handover-v2` envelopes for new tokens
- Keycloak must accept both `handover-v1` (for existing tokens during migration window) and `handover-v2`
- After migration window, `handover-v1` support can be removed

---

## Key Properties

1. **No global derivation secret** — the per-user secret is stored in Postgres `user.handover_secret`
2. **Confidentiality** — the inner payload is not visible to observers between auth-api and Keycloak
3. **Integrity** — GCM auth tag catches ciphertext tampering
4. **Cross-check** — Keycloak cross-validates inner vs outer fields, so ciphertext-only tampering fails
5. **Per-user secret** — one secret per user, not one per device credential
6. **One credential per user** — credentialData holds all binding publicKeyHash entries; resolution is by `publicKeyHash` inside that one credential
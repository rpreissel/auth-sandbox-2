# Device Handover Secret Storage — Postgres + Keycloak Model

## Status

Normative — this document is the authoritative source for the handover secret and credential data model.

## Goals

1. **One persistent secret per user** — stored in Postgres `user.handover_secret`
2. **One Keycloak `device-login` credential per user** (not per device) — credentialData holds all binding publicKeyHash values for that user; secretData holds the per-user Handover Secret
3. **No global derivation** — the master secret from env is removed for device handover
4. **No per-device credentials** — the old one-credential-per-device model is deprecated

---

## Postgres Model

### Table: `user`

Renamed from `registration_people`. One row per userId.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | Internal ID |
| `user_id` | `text` | `unique`, not null | Keycloak username = userId |
| `handover_secret` | `text` | `unique`, not null | 32-byte random secret, base64url-encoded |
| `first_name` | `text` | not null | |
| `last_name` | `text` | not null | |
| `birth_date` | `date` | not null | |
| `created_at` | `timestamptz` | not null | |
| `updated_at` | `timestamptz` | not null | |

**Constraints:**
- `unique (user_id)` — one row per userId
- `unique (handover_secret)` — one secret per user (prevents duplicates)
- `handover_secret` must not be derivable from `user_id`

### Table: `device_bindings`

Holds the device-to-user bindings. The `active` column is removed; hard delete only.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | |
| `device_id` | `uuid` | FK → `devices(id)` | The registered device |
| `user_id` | `text` | not null | References `user.user_id` |
| `keycloak_user_id` | `text` | nullable | Keycloak user ID |
| `keycloak_credential_id` | `text` | nullable | **Unused in handover-v2** — retained for migration only |
| `device_name` | `text` | not null | Moved here from `devices.device_name`; unique per `(user_id, device_name)` |
| `created_at` | `timestamptz` | not null | |

**Constraints:**
- `unique (device_id)` — one active binding per device (no partial unique index on `active`)
- `unique (user_id, device_name)` — one device name per user

### Table: `devices`

After migration: stores the device's cryptographic material. `device_name` is removed.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PK | |
| `public_key` | `text` | not null | RSA public key PEM |
| `public_key_hash` | `text` | `unique` | SHA-256 of public key PEM |
| `created_at` | `timestamptz` | not null | |

---

## Keycloak Credential Model

### One `device-login` credential per user

**credentialData** (JSON):
```json
{
  "version": "handover-v2",
  "bindings": [
    { "publicKeyHash": "<hex>", "deviceName": "Pixel 8" },
    { "publicKeyHash": "<hex>", "deviceName": "MacBook Pro" }
  ]
}
```

- `version: "handover-v2"` — signals the new validation path
- `bindings` — array of all bindings for this user; each entry has `publicKeyHash` (required) and `deviceName` (optional, for display)
- The credential is located by `sub` (userId); Keycloak then scans the `bindings` array for the incoming `publicKeyHash`

**secretData** (JSON):
```json
{
  "handoverSecret": "<base64url>"
}
```

- Contains the **same** value stored in `user.handover_secret` in Postgres
- Keycloak reads this during login validation to decrypt the handover-v2 envelope

### Why redundant storage in Keycloak?

Keycloak cannot call back to auth-api's Postgres during token validation. Therefore the per-user secret must be mirrored into Keycloak's `secretData`. This is the only acceptable redundancy — the Postgres `user` table remains the **source of truth** for credential creation and rotation. auth-api syncs the secret to Keycloak whenever:
- A user is first registered (handover secret created in Postgres)
- A new device is added to an existing user
- A future secret rotation flow is triggered

---

## auth-api Responsibilities

1. **On user registration**: generate a cryptographically random 32-byte secret, store in `user.handover_secret`, and create/update the single Keycloak `device-login` credential for that user with all current bindings.
2. **On new device binding**: fetch the existing `user.handover_secret`, add the new binding to the `bindings` array, and upsert the Keycloak credential.
3. **On login token creation**: use the `user.handover_secret` from Postgres (not derived) to build the AES-256-GCM envelope.
4. **On credential deletion**: remove the binding from the `bindings` array; if no bindings remain, delete the Keycloak credential entirely.

---

## Migration from per-device credentials

The old model had one `device-login` credential per device, each with its own `userHandoverSecret` in `secretData`. The migration path:

1. Create `user.handover_secret` for each existing user (derive from old per-device secrets or generate fresh; decision is out of scope here).
2. Collect all `publicKeyHash` values from all existing device credentials for that user.
3. Create one new-style credential with all those `publicKeyHash` entries in `bindings` and the per-user secret in `secretData`.
4. Delete the old per-device credentials.
5. Remove `device_bindings.active` by converting hard-delete semantics.

---

## Explicitly Excluded

- Per-device Keycloak credentials with per-device secrets — one credential per user is the target
- Global HMAC derivation from `AUTH_API_DEVICE_HANDOVER_DERIVATION_SECRET` — removed
- Any Keycloak Required Actions for this flow
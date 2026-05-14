# Encrypted device login and protected API use

## Summary

A saved device turns the encrypted challenge into OIDC tokens using the **one-step 2FA device login**. The flow is: app requests challenge which returns `allowedSecondFactors` based on credential state; user selects password or biometric; app signs challenge with device privateKey (Factor 1) and sends second factor evidence (Factor 2); auth-api validates the signature and forwards the `login_token` with `secondFactor` to Keycloak; Keycloak validates the second factor (password via credentialManager.isValid() or biometric signature vs stored biometricPublicKey) and issues tokens with acr/amr set accordingly. The handover uses the **handover-v2** protocol: auth-api encrypts the handover payload with AES-256-GCM using the persistent per-user Handover Secret stored in Postgres. Keycloak decrypts, validates the auth tag, and cross-checks the inner values against the outer cleartext fields.

The `acr`/`amr` values are set dynamically per factor combination:
- Device only (no second factor): `acr=1se`, `amr=["hwk"]`
- Device + Password: `acr=2se`, `amr=["hwk","pwd"]`
- Device + Biometric: `acr=2se`, `amr=["hwk","user_presence_mock"]`

> **Normative spec**: see [docs/adr/device-handover-v2.md](../../adr/device-handover-v2.md)


## Diagram

```mermaid
sequenceDiagram
  autonumber
  participant App as AppMock Web
  participant Auth as Auth API
  participant DB as Postgres
  participant KC as Keycloak
  participant Mock as ServiceMock API

  App->>Auth: Start login with public key hash
  Auth->>DB: Load device and binding, check KC credential
  Auth-->>App: Return challenge and allowed second factors
  App->>App: User selects password or biometric
  par Password selected
    App->>App: Sign challenge with device privateKey
    App->>Auth: Finish login with device signature and password
  or Biometric selected
    App->>App: Sign challenge with biometric privateKey
    App->>Auth: Finish login with device signature and biometric proof
  end
  Auth->>DB: Verify nonce, binding, device signature
  Auth->>KC: Exchange device login token with second factor
  KC->>KC: Decrypt handover, cross-check
  KC->>KC: Validate password or biometric evidence
  KC-->>Auth: Return tokens with factor-specific acr and amr
  Auth->>DB: Record login outcome
  Auth-->>App: Return token bundle with acr and amr
  App->>Mock: Call protected endpoint
  Mock->>KC: Validate JWT through JWKS
  Mock-->>App: Return protected business response
```
## Actors

AppMock Web, Auth API, Postgres, Keycloak, ServiceMock API

## Steps

1. **startLogin(publicKeyHash)** (AppMock Web → Auth API): The app sends the stored public-key hash from the saved device binding. Auth-api looks up the device, its device_binding, and checks the Keycloak credential for the user's device-login credential to determine available second factors.
2. **Return challenge + allowedSecondFactors** (Auth API → AppMock Web): The response includes the encrypted challenge data together with the nonce, expiry, and an `allowedSecondFactors` array (always contains `password`; contains `biometric` only if the device credential has a `biometricPublicKey`).
3. **User selects second factor** (AppMock Web): The UI shows only the allowed second factor options. User chooses password or biometric (if biometric is available and the device has a biometric private key stored locally).
4. **Password selected — sign with device key** (AppMock Web → Auth API): The browser signs the base64-decoded encryptedData blob locally with the stored RSA device private key using RSASSA-PKCS1-v1_5 plus SHA-256, then sends the signature together with `{password: "..."}` as `secondFactor`.
5. **Biometric selected — sign with biometric key** (AppMock Web → Auth API): The browser signs the nonce with the biometric private key (separate RSASSA-PKCS1-v1_5 keypair stored in the OS-protected keystore mock), then sends signature together with `{biometricPublicKey, signedChallenge}` as `secondFactor`.
6. **Verify nonce, binding, device signature** (Auth API → Postgres): Auth-api loads the login_challenges row by nonce, rejects unknown, used, or expired challenges, validates the RSA device signature, and confirms that the device_binding still matches userId, deviceId, and publicKeyHash.
7. **login_token with secondFactor** (Auth API → Keycloak): Auth-api marks the challenge as used and forwards a base64url login token containing the handover-v2 envelope (cleartext outer fields + AES-256-GCM encrypted inner payload) plus the `secondFactor` object.
8. **Decrypt handover, cross-check** (Keycloak): Keycloak locates the single `device-login` credential for the user, finds the matching `publicKeyHash` entry inside its `credentialData`, decrypts the inner payload with the per-user `handoverSecret` from `secretData`, validates the GCM auth tag, and cross-checks all duplicated fields before accepting the login.
9. **Validate secondFactor** (Keycloak): If `secondFactor` is `{password}`: validates using `credentialManager.getStoredCredentialsByTypeStream("password").isValid(password)`. If `secondFactor` is `{biometricPublicKey, signedChallenge}`: verifies the presented biometricPublicKey matches the stored one in the credential, then verifies the signedChallenge (nonce) using RSA signature verification against the stored biometricPublicKey. Sets `acr`/`amr` accordingly: `1se`/`["hwk"]` for device-only, `2se`/`["hwk","pwd"]` for password 2FA, `2se`/`["hwk","user_presence_mock"]` for biometric 2FA.
10. **Return token bundle with acr/amr** (Keycloak → Auth API → AppMock Web): The app receives the access, ID, and refresh tokens containing the dynamically-set acr and amr claims.
11. **Record login outcome** (Auth API → Postgres): The successful login updates the stored device usage state.
12. **Call protected endpoint** (AppMock Web → ServiceMock API): The access token is used immediately against the demo API to prove the issued session is usable.
13. **Validate JWT through JWKS** (ServiceMock API → Keycloak): Mock-api verifies the token signature and audience before returning the protected response.
14. **Return protected business response** (ServiceMock API → AppMock Web): The protected API returns a successful business response for the authenticated session.

## Dateien

- `README.md` — diese Datei mit eingebettetem Mermaid-Diagramm
- `diagram.mmd` — Mermaid-Quelltext (Source-of-Truth)

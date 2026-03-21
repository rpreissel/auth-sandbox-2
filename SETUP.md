# SETUP

## Prerequisites

- `pnpm`
- `podman` and `podman-compose`
- Java and Maven for local Keycloak extension builds if you want to rebuild manually

## Install dependencies

```bash
CI=true pnpm install
```

The repo previously hit a local optional Rollup dependency issue on macOS. Reinstalling with `CI=true pnpm install` repairs the workspace state without an interactive prompt.

## Build apps

```bash
pnpm --filter auth-api build
pnpm --filter app-web build
pnpm --filter admin-web build
pnpm --filter home-web build
```

## Start the local stack

Before the first start, generate and trust the fixed local CA/certificate:

```bash
bash scripts/generate-local-certs.sh
bash scripts/trust-local-ca-macos.sh
```

This creates a persistent local CA plus one SAN certificate for `home.localhost`, `app.localhost`, `admin.localhost`, `auth.localhost`, and `keycloak.localhost` in `local-certs/`.

```bash
podman compose up -d
```

Postgres gets extra shutdown time from `compose.yml` so normal `podman compose down` or restart cycles do not cut off long checkpoints. If an older local volume already fails with `invalid checkpoint record`, repair or reset that volume before bringing the stack back up.

This starts:

- one Postgres instance and database with separate schemas for auth-api and Keycloak
- Keycloak with the custom extension
- OpenTofu runner for Keycloak config
- auth-api
- mock-api
- trace-api
- Adminer Postgres viewer
- Caddy reverse proxy

## Verify services

```bash
podman compose ps
curl -k https://auth.localhost:8443/api/health
curl -k https://keycloak.localhost:8443/realms/auth-sandbox-2/.well-known/openid-configuration
curl -k https://db.localhost:8443
```

## Open the apps

- `https://home.localhost:8443`
- `https://app.localhost:8443`
- `https://admin.localhost:8443`
- `https://mock.localhost:8443`
- `https://trace.localhost:8443`
- `https://keycloak.localhost:8443`
- `https://db.localhost:8443`

The certificate should now be trusted by macOS browsers that use the login keychain trust store.

## Manual demo flow

1. Open `https://admin.localhost:8443`
2. Create a registration code for a new `userId`
3. Open `https://app.localhost:8443`
4. Register the device with that code
5. Set the initial password if prompted
6. Start login and finish login
7. Inspect tokens and decoded claims
8. Run refresh
9. Run logout

## Run tests

```bash
pnpm --filter auth-api test
pnpm --filter @auth-sandbox-2/e2e test
```

## Notes

- Keycloak user creation is backend-driven, and `username == userId`.
- Device credentials are created through the custom realm resource endpoint at `/realms/{realm}/device-credentials`.
- Device login is completed through a custom OAuth grant at the Keycloak token endpoint using `grant_type=urn:auth-sandbox-2:params:oauth:grant-type:device-login`.
- `POST /api/flows` is purpose-gated: anonymous callers may create `registration` flows, while `step_up` and `account_upgrade` require a valid Keycloak user bearer token from the allowed app/browser clients.
- When a protected flow payload includes `subjectId`, it must match the bearer user; otherwise `auth-api` derives `subjectId` from the token.
- Generic flow follow-up endpoints require `Authorization: Bearer <flowToken>` returned from `POST /api/flows`.
- Direct identification endpoints require a `serviceToken`, and `POST /api/flows/:flowId/finalize` consumes the returned `serviceResultToken`.
- Internal flow artifact redeem now uses the dedicated Keycloak service-account client `auth-api-internal-redeem`.
- Browser-facing admin, password-setup, mobile step-up, and trace routes are protected with exact demo bearer tokens injected by Caddy.
- `trace-api` browser reads and `POST /client-events` require the trace browser proxy token, while `/internal/observability/*` requires the internal write token.
- The public browser shortcut endpoint was removed; browser step-up now starts only through the Keycloak internal browser-step-up backchannel.
- Adminer connects to the shared `auth_sandbox_2` database; inspect `auth_api` and `keycloak` as separate schemas.

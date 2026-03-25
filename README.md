# auth-sandbox-2

Minimal device-login sandbox with Keycloak, OpenTofu, Caddy, Postgres, React frontends, and a Node.js auth API.

## What this repo does

`auth-sandbox-2` is a focused rebuild of the old sandbox with only the device-login flow:

- registration codes for a `userId`
- device registration with a stored Keycloak device credential
- backend-controlled password setup after registration when needed
- encrypted challenge login
- token display with decoded claims
- refresh and logout

Explicitly out of scope:

- SSO
- CMS
- extra demo or target apps

## Stack

- `auth-api` - Node.js + TypeScript + Fastify
- `appmock-web` - React + TypeScript device flow UI
- `admin-web` - React + TypeScript admin UI
- `webmock-web` - React + TypeScript browser login and browser step-up demo
- `servicemock-api` - Fastify demo REST API protected by Keycloak JWKS and audience validation
- `trace-web` - React + TypeScript trace explorer UI
- `trace-api` - Fastify trace and observability API
- `home-web` - React + TypeScript landing page
- `keycloak` - IAM and credential authority
- `postgres` - shared storage for auth-api and Keycloak with separate schemas
- `caddy` - local reverse proxy
- `opentofu` - Keycloak realm, client, scope, and flow config

## Local URLs

- `https://home.localhost:8443` - landing page
- `https://appmock.localhost:8443` - device app
- `https://admin.localhost:8443` - admin app
- `https://webmock.localhost:8443` - browser step-up demo
- `https://trace.localhost:8443` - trace viewer
- `https://auth.localhost:8443/api/health` - auth API health
- `https://webmock.localhost:8443/health` - mock API health
- `https://trace.localhost:8443/health` - trace API health
- `https://keycloak.localhost:8443` - Keycloak
- `https://db.localhost:8443` - Adminer Postgres viewer

## Main flow

1. Admin creates a registration code for a `userId`.
2. Device app registers a device with `userId`, `deviceName`, `activationCode`, and a signing public key.
3. Backend ensures the Keycloak user exists and stores a custom `device-login` credential in Keycloak.
4. Backend checks whether the Keycloak user already has a password.
5. If not, the app submits an initial password and the backend sets it via the Keycloak Admin API.
6. Device app requests an encrypted challenge from `auth-api`.
7. Device app signs the encrypted payload and sends it back.
8. `auth-api` exchanges the signed challenge at the Keycloak token endpoint with a custom OAuth grant, and Keycloak validates the custom device credential before issuing OIDC tokens.
9. App uses the access token to call `servicemock-api`, which verifies the token with Keycloak JWKS and the expected audience.
10. App shows access token, ID token, refresh token, decoded claims, and mock API responses.
11. App can refresh tokens and log out.

```mermaid
sequenceDiagram
  autonumber
  actor Admin
  participant Device as appmock-web
  participant Browser as webmock-web
  participant Caddy
  participant Auth as auth-api
  participant DB
  participant KC as Keycloak
  participant Ext as KC extension
  participant Mock as servicemock-api

  Admin->>Caddy: Create registration identity
  Caddy->>Auth: Forward with admin proxy token
  Auth->>DB: Store code
  Auth-->>Admin: Code issued

  Device->>Auth: Register device
  Auth->>DB: Create registration flow
  Auth->>KC: Ensure user + create device credential
  KC-->>Auth: OK
  Auth-->>Device: Device registered\n(password setup may be required)

  Device->>Caddy: Set initial password
  Caddy->>Auth: Forward with app proxy token
  Auth->>KC: Set password via Admin API
  KC-->>Auth: Password stored
  Auth-->>Device: Password accepted

  Device->>Auth: Start device login
  Auth->>DB: Store encrypted challenge
  Auth-->>Device: Challenge payload

  Device->>Auth: Finish device login with signature
  Auth->>KC: Custom device-login grant
  KC-->>Auth: Token bundle
  Auth-->>Device: Access / ID / Refresh tokens

  Device->>Mock: Call protected API with access token
  Mock->>KC: Verify JWT via JWKS
  Mock-->>Device: Protected response

  Browser->>KC: Browser login with acr_values=1se
  KC-->>Browser: Browser session / tokens

  Browser->>KC: Fresh auth request with acr_values=2se
  KC->>Ext: Start inline browser step-up
  Ext->>Auth: POST /api/internal/browser-step-up/start\nBearer internal redeem token
  Auth->>DB: Create step-up flow + SMS challenge
  Auth-->>Ext: flowId + maskedTarget + demo TAN
  Browser->>KC: Submit SMS-TAN in Keycloak form
  KC->>Ext: Complete inline browser step-up
  Ext->>Auth: POST /api/internal/browser-step-up/complete\nBearer internal redeem token
  Auth->>DB: Finalize flow + issue result_code
  Ext->>Auth: POST /api/internal/flows/redeem\nBearer internal redeem token
  Auth->>DB: Consume result_code
  Auth-->>Ext: achievedAcr + amr + authTime
  Ext-->>KC: Upgrade browser session
  KC-->>Browser: Upgraded browser session / tokens
```

## Architecture notes

- Keycloak `username` always equals `userId`.
- The encrypted challenge remains mandatory in the login flow.
- No Keycloak Required Actions are used for this password flow.
- Keycloak configuration is managed through OpenTofu in `infra/tofu/keycloak`.
- The device login token exchange now uses a custom OAuth grant at `/protocol/openid-connect/token` instead of a browser redirect flow.
- The remaining custom Keycloak logic lives in `keycloak-extension`.
- Frontends are built statically and served by Caddy.

## Flow endpoint protection

- `POST /api/device/login/start`, `POST /api/device/login/finish`, `POST /api/device/token/refresh`, and `POST /api/device/logout` are reachable without a separate API bearer token.
- `POST /api/device/login/start`, `POST /api/device/login/finish`, `POST /api/device/token/refresh`, and `POST /api/device/logout` are still proof-bound by device registration state, challenge validation, signatures, or refresh-token validity.
- `POST /api/flows` is now purpose-gated: anonymous callers may bootstrap `registration`, while `step_up` and `account_upgrade` require a valid Keycloak user bearer token from the allowed browser/app clients.
- Protected flow creation also binds `subjectId` to the bearer user: mismatches are rejected, and missing `subjectId` values are filled from the token.
- `GET /api/flows/:flowId`, `POST /api/flows/:flowId/select-service`, and `POST /api/flows/:flowId/finalize` require `Authorization: Bearer <flowToken>`.
- Direct identification endpoints require `Authorization: Bearer <serviceToken>` and return a `serviceResultToken` for finalization.
- `POST /api/admin/registration-identities`, `GET /api/admin/registration-identities`, `GET /api/admin/devices`, `DELETE /api/admin/devices/:id`, `POST /api/device/set-password`, and `POST /api/step-up/mobile/complete` are protected by exact proxy bearer tokens that Caddy injects for the demo browser apps.
- `POST /api/internal/browser-step-up/start`, `POST /api/internal/browser-step-up/complete`, and `POST /api/internal/flows/redeem` require a Keycloak bearer token from the dedicated service-account client `auth-api-internal-redeem`.
- `trace-api` browser reads and `client-events` require a dedicated browser proxy token, while `/internal/observability/*` requires a separate internal write token.
- The old public browser shortcut `POST /api/step-up/browser/start` was removed. Browser step-up now starts only inside Keycloak through the internal backchannel flow.
- Flow, service, and service-result tokens are HMAC-signed by `auth-api`, scoped to their intended use, and expire with the flow record. Redeem artifacts remain single-use, kind-checked, and expiry-checked after bearer-token validation.

```mermaid
flowchart TB
  subgraph Public[Reachable without API bearer token]
    P1[POST /api/flows]
    P2[POST /api/device/login/start]
    P3[POST /api/device/login/finish]
    P4[POST /api/device/token/refresh]
    P5[POST /api/device/logout]
    P6[GET health endpoints]
  end

  subgraph Proxy[Browser routes protected by Caddy-injected demo bearer tokens]
    AdminToken[admin proxy token] --> A1[/api/admin/*/]
    AppToken[app proxy token] --> A2[/api/device/set-password/]
    AppToken --> A3[/api/step-up/mobile/complete/]
    TraceToken[trace browser proxy token] --> T1[/traces/]
    TraceToken --> T2[/traces/:traceId/]
    TraceToken --> T3[/spans/:spanId/]
    TraceToken --> T4[/artifacts/:artifactId/]
    TraceToken --> T5[/client-events/]
  end

  subgraph AuthTokens[Token-scoped auth-api routes]
    FlowToken[flowToken] --> F1[/GET /api/flows/:flowId/]
    FlowToken --> F2[/POST /api/flows/:flowId/select-service/]
    FlowToken --> F3[/POST /api/flows/:flowId/finalize/]
    ServiceToken[serviceToken] --> S1[/POST /api/identification/person-code/complete/]
    ServiceToken --> S2[/POST /api/identification/sms-tan/start/]
    ServiceToken --> S3[/POST /api/identification/sms-tan/resend/]
    ServiceToken --> S4[/POST /api/identification/sms-tan/complete/]
  end

  subgraph Internal[Backchannel-only routes]
    KCBearer[Keycloak service-account bearer] --> I1[/POST /api/internal/browser-step-up/start/]
    KCBearer --> I2[/POST /api/internal/browser-step-up/complete/]
    KCBearer --> I3[/POST /api/internal/flows/redeem/]
    TraceWrite[trace internal write token] --> I4[/POST /internal/observability/*/]
  end
```

## Important paths

- `apps/auth-api` - backend API, DB migrations, Keycloak integration
- `apps/appmock-web` - device registration, login, claims, refresh, logout
- `apps/servicemock-api` - OIDC/JWKS protected mock REST endpoints for appmock-web
- `apps/admin-web` - registration code and device admin UI
- `apps/home-web` - landing page with links and flow diagram
- `packages/shared-types` - shared request and response types
- `keycloak-extension` - custom device credential and login authenticator
- `infra/tofu/keycloak` - realm and flow config
- `e2e` - Playwright coverage

## Run locally

1. Install workspace dependencies:

```bash
CI=true pnpm install
```

2. Build the local apps if needed:

```bash
pnpm build
```

3. Start the runtime stack:

```bash
bash scripts/generate-local-certs.sh
bash scripts/trust-local-ca-macos.sh
```

This sets up a fixed local CA and server certificate for all `*.localhost` hosts used by the sandbox.

4. Start the runtime stack:

```bash
podman compose up -d
```

Postgres has an extended shutdown grace period in `compose.yml` because Podman can otherwise interrupt long checkpoints and corrupt the local WAL during `down`/restart cycles. If an older local volume already fails with `invalid checkpoint record`, repair or reset that volume before starting the stack again.

5. Check the main health endpoint:

```bash
curl -k https://auth.localhost:8443/api/health
```

6. Open the Postgres viewer when you need to inspect the shared database:

- URL: `https://db.localhost:8443`
- System: `PostgreSQL`
- Server: `postgres`
- Username: `postgres`
- Password: `postgres`
- Database: `auth_sandbox_2`

Use the `auth_api` and `keycloak` schemas to inspect app data separately inside the same database.

## Quality checks

```bash
pnpm --filter auth-api test
pnpm --filter auth-api build
pnpm --filter servicemock-api build
pnpm --filter appmock-web build
pnpm --filter admin-web build
pnpm --filter home-web build
pnpm --filter @auth-sandbox-2/e2e test
```

## Current status

- End-to-end device flow works: register, set password, login, refresh, logout.
- Playwright covers homepage navigation plus the full device flow.
- Runtime uses one PostgreSQL database with separate schemas for `auth-api` and Keycloak.

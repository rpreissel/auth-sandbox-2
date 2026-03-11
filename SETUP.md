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

```bash
podman-compose up -d
```

This starts:

- Postgres for app data
- Postgres for Keycloak
- Keycloak with the custom extension
- OpenTofu runner for Keycloak config
- auth-api
- Grafana, Tempo, Loki, OTEL collector
- Caddy reverse proxy

## Verify services

```bash
podman-compose ps
curl -k https://auth.localhost:8443/api/health
curl -k https://keycloak.localhost:8443/realms/auth-sandbox-2/.well-known/openid-configuration
```

## Open the apps

- `https://home.localhost:8443`
- `https://app.localhost:8443`
- `https://admin.localhost:8443`
- `https://keycloak.localhost:8443`
- `https://grafana.localhost:8443`

If your browser warns about the certificate, trust Caddy's local CA or continue once for local development.

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
- The Keycloak browser flow is intentionally minimal and uses a single `device-login-token` authenticator execution.
- The OTEL collector currently starts but may still report unhealthy or refuse exports locally; this does not block the core device-login demo flow.

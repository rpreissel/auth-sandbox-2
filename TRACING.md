# Tracing

## Purpose

This repo captures end-to-end demo traces across browser clients, backend APIs, outbound Keycloak calls, and proxy access logs.

The goal is to make the main auth flows inspectable, not to provide production-grade observability defaults.

## Trace model

- `x-trace-id` identifies one visible end-to-end trace in the demo
- `x-correlation-id` follows the same request chain across services and proxy logs
- `x-session-id` groups browser interactions that belong to the same local app session
- `x-span-id` links nested work to a parent span when a caller already has one

In the browser apps, `traceId` and `correlationId` are usually set to the same UUID.

## Where traces come from

### Browser clients

- `appmock-web`, `webmock-web`, `admin-web`, and `trace-web` send trace headers on API calls
- `appmock-web` and `webmock-web` also emit explicit client telemetry to `POST /trace-api/client-events`

### auth-api

- each traced route creates a root request trace/span context
- service operations create nested spans via `runWithSpan`
- outbound Keycloak calls record request and response artifacts, including decoded token artifacts where relevant

### servicemock-api

- protected API routes create their own traced request spans and keep the incoming trace identifiers

### trace-api

- stores traces, spans, artifacts, and field explanations
- accepts browser client events on `/client-events`
- accepts internal write traffic on `/internal/observability/*`

### Caddy

- access logs are written to `runtime/caddy-logs/access.json`
- `trace-web` uses `correlation_id` to line up proxy hops with application traces when available

## Main capture points

### Device registration and password bootstrap

- registration flow creation
- service selection and verification
- flow finalization
- password setup through backend-admin Keycloak call

### Device login

- challenge creation in `auth-api`
- encrypted challenge artifact with decrypted demo view
- login token handoff to Keycloak
- Keycloak token response, decoded JWT artifacts, userinfo, and introspection

### Browser login and step-up

- browser client events from `webmock-web`
- internal browser step-up start and complete calls from Keycloak extension to `auth-api`
- step-up flow finalization and result-code redeem

### SSO bootstrap

- SSO launch creation
- signed bootstrap state artifact
- PAR-based Keycloak authorization URL artifact
- callback redemption and allowlisted target redirect artifact

## Reading traces in the UI

Open `https://trace.localhost:8443`.

Typical workflow:

1. Filter by `userId` or open the latest matching trace.
2. Inspect the span timeline to see browser, backend, Keycloak, and mock API hops.
3. Open artifacts to inspect raw, decoded, decrypted, and explained views.
4. Cross-check proxy hops in the detail page when `correlationId` is present in Caddy logs.

## Current limitations

- page loads and static asset requests do not always carry useful trace identifiers in Caddy logs
- trace payloads are intentionally rich in this sandbox and can contain sensitive demo data
- this setup prefers inspectability over strict payload minimization

## Sensitive data note

Trace access must be treated as privileged. The demo intentionally stores rich request and response payloads, decoded JWTs, and decrypted challenge views for inspection.

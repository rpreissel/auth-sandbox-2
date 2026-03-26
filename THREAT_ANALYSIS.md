# Threat Analysis

This document summarizes the main trust boundaries, attack surfaces, abuse cases, mitigations, and residual risks in the current `auth-sandbox-2` architecture.

## Scope

Included:

- device registration and encrypted device login
- concrete registration and step-up flow bootstrap plus shared flow finalization
- browser step-up via Keycloak backchannel
- proxy-protected admin/password/trace routes
- internal redeem and observability write paths

Out of scope:

- production-grade secret distribution
- internet-facing WAF/CDN concerns
- host compromise on the local demo machine

## Trust Boundaries

1. Browser or device client -> Caddy / public APIs
2. Caddy -> browser-facing backend routes protected by exact proxy bearer tokens
3. `auth-api` -> Keycloak Admin API and custom grant / redeem integrations
4. Keycloak extension -> `auth-api` internal browser-step-up and redeem endpoints
5. Backend services -> `trace-api` internal observability write endpoints
6. Services -> PostgreSQL persistence layer

The most important design rule is that the system does not trust network reachability by itself. Each sensitive hop is expected to carry either a flow token, a service token, a user bearer token, an internal Keycloak service-account bearer, or an exact proxy token.

## High-Value Assets

- Keycloak user accounts, sessions, and issued tokens
- device credentials and encrypted challenge material
- flow state, service state, and redeem artifacts
- admin registration identities and device inventory
- trace data, which includes sensitive demo payloads by design
- proxy tokens and internal write/redeem tokens

## Main Attack Surfaces

### Publicly reachable without separate API bearer token

- `POST /api/registration-flows` for anonymous registration bootstrap
- `POST /api/step-up-flows` with a valid Keycloak user bearer
- `POST /api/device/login/start`
- `POST /api/device/login/finish`
- `POST /api/device/token/refresh`
- `POST /api/device/logout`
- health endpoints

### Browser-facing but protected through Caddy-injected exact tokens

- `/api/admin/*`
- `/api/device/set-password`
- `/api/step-up/mobile/complete`
- trace read routes and `/client-events`

### Token-scoped `auth-api` flow endpoints

- `/api/flows/:flowId`
- `/api/flows/:flowId/select-service`
- `/api/flows/:flowId/finalize`
- direct identification endpoints using `serviceToken`

### Internal-only backchannel surfaces

- `/api/internal/browser-step-up/start`
- `/api/internal/browser-step-up/complete`
- `/api/internal/flows/redeem`
- `/internal/observability/*`

## Likely Abuse Cases

### 1. Anonymous creation spam against flow bootstrap

Risk:

- an attacker creates large numbers of registration flows to exhaust storage, SMS capacity, or operator attention

Current mitigations:

- step-up flow creation now requires a valid Keycloak user bearer token
- follow-up steps require flow or service tokens
- flow records expire

Residual risk:

- anonymous `registration` bootstrap is still intentionally open, so volumetric abuse remains possible without separate rate limiting or client gating

### 2. Cross-user protected flow creation

Risk:

- a valid user bearer is used to create a step-up flow for a different subject

Current mitigations:

- protected `POST /api/step-up-flows` checks the Keycloak bearer
- provided `userId` must match the bearer user
- missing `userId` is derived from the bearer token

Residual risk:

- correctness depends on accepted claims and allowed client IDs staying narrow

### 3. Replay or token confusion in flow execution

Risk:

- replaying old flow/service tokens or mixing tokens across flows and methods

Current mitigations:

- flow, service, and service-result tokens are scoped and HMAC-signed
- finalize and redeem paths validate artifact kind, state, and expiry
- method/purpose compatibility is enforced in the flow engine

Residual risk:

- any state-machine bug in the flow engine could still create bypasses, so this remains a core correctness risk

### 4. Abuse of public device-login endpoints

Risk:

- attackers call login start/finish directly, brute force devices, or replay signed payloads

Current mitigations:

- login start requires a known device binding
- login finish depends on encrypted challenge state, nonce validation, and signature verification
- refresh/logout depend on valid refresh tokens issued by Keycloak

Residual risk:

- brute-force and traffic-flood resistance still depends on outer controls; the demo currently prioritizes correctness over layered anti-abuse controls

### 5. Exposure or misuse of Caddy-injected proxy tokens

Risk:

- if an attacker obtains a proxy token, they can directly call admin/password/trace browser routes through the protected surface

Current mitigations:

- tokens are exact-match secrets, split by purpose
- browser-facing routes were moved behind token checks in `auth-api` and `trace-api`
- sensitive behavior is no longer justified purely by same-origin access

Residual risk:

- this is still a demo-grade shared-secret model; proxy token leakage would be high impact

### 6. Abuse of internal redeem or observability write endpoints

Risk:

- forged internal calls could redeem step-up artifacts, mint elevated auth context, or write fake observability data

Current mitigations:

- internal redeem/browser-step-up endpoints require a Keycloak bearer from the dedicated service-account client
- internal observability writes require a separate exact write token
- browser trace reads use a different token from internal writes

Residual risk:

- compromise of the service-account or internal write token would still allow high-impact internal impersonation

### 7. Sensitive data leakage through tracing

Risk:

- traces intentionally capture rich demo payloads, which may expose personal data, codes, tokens, or challenge material to anyone who can read trace data

Current mitigations:

- browser trace access now requires the trace browser proxy token
- internal writes use a separate token

Residual risk:

- trace data remains intentionally sensitive in this sandbox, so read access should be treated as privileged

### 8. Browser step-up frontchannel shortcut abuse

Risk:

- a public endpoint could have allowed unauthenticated or weakly-bound step-up bootstrap outside Keycloak's browser flow

Current mitigations:

- the old public browser shortcut was removed
- browser step-up starts only inside Keycloak and completes via internal backchannel redeem

Residual risk:

- the Keycloak extension and redeem contract now carry more trust and must remain tightly validated

## Existing Mitigation Summary

- separate concrete create endpoints for anonymous registration and bearer-bound step-up
- subject binding for protected flow creation
- signed, scoped, expiring flow/service tokens
- dedicated internal Keycloak service-account bearer for redeem paths
- separate proxy tokens for admin/app/trace browser surfaces
- separate trace internal write token
- no public browser step-up shortcut
- backend-driven password setup and user provisioning
- encrypted challenge and signature-based device login
- artifact single-use and expiry checks during redeem/finalize

## Highest Residual Risks

1. Anonymous `registration` bootstrap can still be spammed without rate limiting.
2. Shared demo secrets in Caddy/proxy/internal-token configuration are high impact if leaked.
3. Trace data is intentionally sensitive and remains a privileged read surface.
4. The flow engine is security-critical; state-machine or claim-validation bugs could bypass intended policy.
5. Internal Keycloak extension and redeem integration are trusted components with strong impact if misconfigured.

## Recommended Next Hardening Steps

1. Add rate limits and simple abuse telemetry for anonymous registration flow creation.
2. Narrow accepted user bearer claims further if possible, for example by explicitly validating issuer plus intended client semantics per route.
3. Reduce trace-data exposure by redacting especially sensitive artifacts or making full payload capture opt-in outside the demo mode.
4. Replace demo shared-secret proxy protection with stronger service-to-service trust where the architecture needs to grow beyond local sandbox use.
5. Add more negative E2E and integration coverage for cross-user flow creation, token misuse, expired artifacts, and internal endpoint rejection paths.
6. Document operational rotation expectations for proxy tokens, internal write tokens, and internal redeem credentials.

## Overall Assessment

For a local demo sandbox, the current posture is materially better than the earlier fully open bootstrap model. The largest remaining risks are not broken authentication logic for protected flows, but the intentional presence of an anonymous registration bootstrap, sensitive trace visibility, and reliance on demo-grade shared secrets for proxy/internal boundaries.

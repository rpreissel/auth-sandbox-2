# Refresh and logout lifecycle

## Summary

The device session stays renewable through Keycloak refresh tokens and can be revoked again through the logout endpoint.

## Actors

AppMock Web, Auth API, Keycloak

## Steps

1. **Refresh token bundle** (AppMock Web → Auth API): When the session should continue, AppMock Web sends the current refresh token to auth-api.
2. **Redeem refresh token** (Auth API → Keycloak): Auth-api posts grant_type=refresh_token together with the OIDC client credentials to the Keycloak token endpoint and asks for a fresh access, ID, and refresh-token bundle for the existing device session.
3. **Rotate refresh-token session state** (Auth API → Keycloak): Keycloak can rotate the refresh token and extend the server-side session lifetime while preserving the existing user session, so no new device challenge or browser authentication step is required.
4. **Return rotated tokens** (Auth API → AppMock Web): Auth-api returns a renewed token bundle and the app replaces its stored session tokens.
5. **Request logout** (AppMock Web → Auth API): To end the session, AppMock Web sends the still-valid refresh token to auth-api.
6. **Revoke session at logout endpoint** (Auth API → Keycloak): Auth-api posts client credentials plus the refresh token to the Keycloak logout endpoint, which invalidates the linked refresh token and ends the server-side OIDC session for that client session.
7. **Reject future refresh redemption** (Auth API → Keycloak): After logout the old refresh token becomes unusable for the refresh_token grant, which means the next session must go back through a fresh encrypted device-login challenge and signature proof.
8. **Confirm local session clear** (Auth API → AppMock Web): The app clears its session tokens but keeps the stored device binding for later login.

## Dateien

- `diagram.mmd` — Mermaid-Quelltext (versioniert)
- `diagram.svg` — gerendertes Diagramm (GitHub-nativ sichtbar)
- `README.md` — diese Datei

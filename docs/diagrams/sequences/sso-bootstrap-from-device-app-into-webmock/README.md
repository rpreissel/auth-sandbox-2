# SSO bootstrap from device app into WebMock

## Summary

AppMock Web can prepare an allowlisted browser bootstrap into WebMock through auth-api and Keycloak PAR state.

## Actors

AppMock Web, Auth API, Keycloak, WebMock Web

## Steps

1. **Create SSO bootstrap launch** (AppMock Web → Auth API): AppMock Web creates a controlled browser bootstrap request from the current authenticated device context.
2. **Create PAR-based auth launch** (Auth API → Keycloak): Auth-api verifies that the bearer subject matches the requested user, consumes the device-login challenge into a login_token, creates a signed short-lived bootstrap state, and posts a PAR request with login_token, state, requested acr, client credentials, and redirect_uri to Keycloak.
3. **Persist signed bootstrap state and allowlisted target** (Auth API → Auth API): The state payload is an HMAC-signed base64url envelope that carries jti, targetId, targetClientId, normalized targetPath, requestedAcr, and exp so the callback can reject tampered state, expired launches, or target paths that leave the allowlisted origin.
4. **Return launch URL and target** (Auth API → AppMock Web): The response returns the prepared Keycloak launch URL together with the resolved target URL.
5. **Open bootstrap login tab** (AppMock Web → Keycloak): The browser opens the prepared launch URL instead of constructing its own redirect path.
6. **Redeem callback and resolve target** (Keycloak → Auth API): After the authorization code redirect reaches auth-api, the callback redeems the code with the bootstrap client credentials, validates the HMAC-signed state with timing-safe comparison, checks expiry and target metadata, and rebuilds the final allowlisted browser destination.
7. **Attach browser session bootstrap context** (Auth API → WebMock Web): The browser arrives in WebMock with a normal Keycloak browser session established during the bootstrap flow.
8. **Redirect into WebMock** (Auth API → WebMock Web): Auth-api returns a 303 redirect to the allowlisted WebMock URL, and the browser lands there with a ready Keycloak session that can continue either as 1se or directly request a stronger 2se step-up path.

## Dateien

- `diagram.mmd` — Mermaid-Quelltext (versioniert)
- `diagram.svg` — gerendertes Diagramm (GitHub-nativ sichtbar)
- `README.md` — diese Datei

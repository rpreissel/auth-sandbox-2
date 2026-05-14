package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.Response;
import org.keycloak.OAuthErrorException;
import org.keycloak.credential.CredentialModel;
import org.keycloak.events.Details;
import org.keycloak.events.Errors;
import org.keycloak.events.EventType;
import org.keycloak.authentication.authenticators.util.AcrStore;
import org.keycloak.models.ClientSessionContext;
import org.keycloak.models.Constants;
import org.keycloak.models.UserModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.protocol.oidc.OIDCLoginProtocol;
import org.keycloak.protocol.oidc.TokenManager;
import org.keycloak.protocol.oidc.grants.OAuth2GrantTypeBase;
import org.keycloak.services.CorsErrorResponseException;
import org.keycloak.services.Urls;
import org.keycloak.services.managers.AuthenticationManager;
import org.keycloak.services.managers.AuthenticationSessionManager;
import org.keycloak.services.managers.UserSessionManager;
import org.keycloak.sessions.AuthenticationSessionModel;
import org.keycloak.sessions.RootAuthenticationSessionModel;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.Map;

public class DeviceLoginGrantType extends OAuth2GrantTypeBase {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String LOGIN_TOKEN_PARAM = "login_token";
    private static final String ACR_1SE = "1se";
    private static final String ACR_2SE = "2se";

    @Override
    public Response process(Context context) {
        setContext(context);
        event.detail(Details.AUTH_METHOD, "device_grant");
        GrantTypeTraceSupport.GrantTrace trace = GrantTypeTraceSupport.start(
                firstNonBlank(
                        session.getContext().getRequestHeaders().getHeaderString("x-trace-id"),
                        session.getContext().getRequestHeaders().getHeaderString("x-correlation-id")
                ),
                session.getContext().getRequestHeaders().getHeaderString("x-session-id"),
                session.getContext().getUri().getRequestUri().toString(),
                session.getContext().getUri().getPath(),
                session.getContext().getHttpRequest().getHttpMethod(),
                clientConnection.getRemoteHost(),
                realm,
                client,
                context.getGrantType(),
                DeviceLoginGrantTypeFactory.GRANT_TYPE,
                "device_grant",
                null,
                true,
                false,
                false
        );

        if (client.isBearerOnly() || client.isPublicClient()) {
            String errorMessage = "Client not allowed to use device login grant";
            event.detail(Details.REASON, errorMessage);
            event.error(Errors.NOT_ALLOWED);
            trace.error(errorMessage);
            throw new CorsErrorResponseException(cors, OAuthErrorException.UNAUTHORIZED_CLIENT, errorMessage, Response.Status.BAD_REQUEST);
        }

        if (client.isConsentRequired()) {
            String errorMessage = "Client requires user consent";
            event.detail(Details.REASON, errorMessage);
            event.error(Errors.CONSENT_DENIED);
            trace.error(errorMessage);
            throw new CorsErrorResponseException(cors, OAuthErrorException.INVALID_CLIENT, errorMessage, Response.Status.BAD_REQUEST);
        }

        String loginToken = formParams.getFirst(LOGIN_TOKEN_PARAM);
        if (loginToken == null || loginToken.isBlank()) {
            trace.error("Missing parameter: " + LOGIN_TOKEN_PARAM);
            throw new CorsErrorResponseException(cors, OAuthErrorException.INVALID_REQUEST, "Missing parameter: " + LOGIN_TOKEN_PARAM, Response.Status.BAD_REQUEST);
        }

        String scope = getRequestedScopes();

        try {
            LoginTokenSupport.DeviceLoginPayload payload = LoginTokenSupport.parseLoginToken(loginToken);
            if (!"device".equals(payload.type())) {
                throw new IllegalArgumentException("Unsupported login token type");
            }
            LoginTokenSupport.validateExpiry(payload);
            if (!LoginTokenSupport.markSingleUse(session, payload)) {
                throw new IllegalArgumentException("login_token already used");
            }

            UserModel user = session.users().getUserByUsername(realm, payload.sub());
            if (user == null) {
                throw new IllegalArgumentException("User not found");
            }
            trace.updateResolvedUser(user.getUsername(), user.getId());
            trace.recordArtifact("device_grant_validation", Map.of(
                    "userId", user.getUsername(),
                    "publicKeyHash", payload.publicKeyHash(),
                    "hasHandoverEnvelope", payload.handoverIv() != null && !payload.handoverIv().isBlank()
            ), "Validated device grant login_token against stored device credential.");

            event.user(user);
            event.detail(Details.USERNAME, user.getUsername());

            if (!user.isEnabled()) {
                throw new IllegalArgumentException("User disabled");
            }

            if (user.getRequiredActionsStream().findAny().isPresent()) {
                throw new IllegalArgumentException("Account is not fully set up");
            }

            DeviceCredentialModel matchedModel = user.credentialManager()
                    .getStoredCredentialsByTypeStream(DeviceCredentialModel.TYPE)
                    .map(DeviceCredentialModel::createFromCredentialModel)
                    .filter(cred -> cred.findBinding(payload.publicKeyHash()) != null)
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Device credential not found"));

            String handoverSecret = matchedModel.getHandoverSecret();
            if (handoverSecret == null || handoverSecret.isBlank()) {
                throw new IllegalArgumentException("No handover secret in matched credential");
            }

            String acrValue = ACR_1SE;
            java.util.List<String> amrValue = new java.util.ArrayList<>();
            amrValue.add("hwk");

            if (payload.secondFactor() != null) {
                if (payload.secondFactor().containsKey("password")) {
                    String password = (String) payload.secondFactor().get("password");
                    boolean passwordValid = user.credentialManager()
                            .getStoredCredentialsByTypeStream("password")
                            .anyMatch(cred -> {
                                try {
                                    return cred.isValid(password);
                                } catch (Exception e) {
                                    return false;
                                }
                            });
                    if (!passwordValid) {
                        throw new IllegalArgumentException("Invalid password credential");
                    }
                    acrValue = ACR_2SE;
                    amrValue.add("pwd");
                } else if (payload.secondFactor().containsKey("biometricPublicKey") && payload.secondFactor().containsKey("signedChallenge")) {
                    String storedBiometricKey = matchedModel.getBiometricPublicKey();
                    if (storedBiometricKey == null || storedBiometricKey.isBlank()) {
                        throw new IllegalArgumentException("No biometric key registered for this device");
                    }
                    String presentedBiometricKey = (String) payload.secondFactor().get("biometricPublicKey");
                    String signedChallenge = (String) payload.secondFactor().get("signedChallenge");
                    if (!presentedBiometricKey.equals(storedBiometricKey)) {
                        throw new IllegalArgumentException("Biometric key mismatch");
                    }
                    try {
                        byte[] keyBytes = Base64.getUrlDecoder().decode(storedBiometricKey);
                        X509EncodedKeySpec keySpec = new X509EncodedKeySpec(keyBytes);
                        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
                        java.security.PublicKey publicKey = keyFactory.generatePublic(keySpec);
                        byte[] challengeBytes = Base64.getUrlDecoder().decode(payload.nonce());
                        byte[] signatureBytes = Base64.getUrlDecoder().decode(signedChallenge);
                        Signature verifier = Signature.getInstance("SHA256withRSA");
                        verifier.initVerify(publicKey);
                        verifier.update(challengeBytes);
                        if (!verifier.verify(signatureBytes)) {
                            throw new IllegalArgumentException("Biometric signature verification failed");
                        }
                    } catch (IllegalArgumentException e) {
                        throw e;
                    } catch (Exception e) {
                        throw new IllegalArgumentException("Biometric signature verification error: " + e.getMessage());
                    }
                    acrValue = ACR_2SE;
                    amrValue.add("user_presence_mock");
                }
            }

            if (!TokenManager.verifyConsentStillAvailable(session, user, client, TokenManager.getRequestedClientScopes(session, scope, client, user))) {
                String errorMessage = "Client no longer has requested consent from user";
                event.detail(Details.REASON, errorMessage);
                event.error(Errors.NOT_ALLOWED);
                throw new CorsErrorResponseException(cors, OAuthErrorException.INVALID_SCOPE, errorMessage, Response.Status.BAD_REQUEST);
            }

            RootAuthenticationSessionModel rootAuthSession = new AuthenticationSessionManager(session).createAuthenticationSession(realm, false);
            AuthenticationSessionModel authSession = rootAuthSession.createAuthenticationSession(client);
            authSession.setAuthenticatedUser(user);
            authSession.setProtocol(OIDCLoginProtocol.LOGIN_PROTOCOL);
            authSession.setClientNote(OIDCLoginProtocol.ISSUER, Urls.realmIssuer(session.getContext().getUri().getBaseUri(), realm.getName()));
            authSession.setClientNote(OIDCLoginProtocol.SCOPE_PARAM, scope);

            UserSessionModel userSession = new UserSessionManager(session).createUserSession(
                    authSession.getParentSession().getId(),
                    realm,
                    user,
                    user.getUsername(),
                    clientConnection.getRemoteHost(),
                    "device-grant",
                    false,
                    null,
                    null,
                    UserSessionModel.SessionPersistenceState.PERSISTENT
            );
            event.session(userSession);
            trace.updateSessions(authSession.getParentSession().getId(), userSession.getId());
            trace.updateAssurance(acrValue, amrValue);
            trace.refreshContextArtifact();

            AuthenticationManager.setClientScopesInSession(session, authSession);
            AcrStore acrStore = new AcrStore(session, authSession);
            acrStore.setLevelAuthenticated(acrValue.equals(ACR_2SE) ? 2 : 1);
            authSession.setAuthNote("acr", acrValue);
            authSession.setUserSessionNote("acr", acrValue);
            String loaMap = authSession.getAuthNote("loa-map");
            if (loaMap != null) {
                authSession.setUserSessionNote("loa-map", loaMap);
                userSession.setNote("loa-map", loaMap);
            }
            userSession.setNote("acr", acrValue);
            userSession.setNote("amr", String.join(" ", amrValue));
            ClientSessionContext clientSessionCtx = TokenManager.attachAuthenticationSession(session, userSession, authSession);
            clientSessionCtx.setAttribute(Constants.GRANT_TYPE, context.getGrantType());
            updateUserSessionFromClientAuth(userSession);

            TokenManager.AccessTokenResponseBuilder responseBuilder = createTokenResponseBuilder(user, userSession, clientSessionCtx, scope, null);
            trace.success("Completed device-login grant token issuance.");
            return createTokenResponse(responseBuilder, clientSessionCtx, true);
        } catch (CorsErrorResponseException exception) {
            trace.error(exception.getMessage());
            throw exception;
        } catch (Exception exception) {
            event.detail(Details.REASON, exception.getMessage());
            event.error(Errors.INVALID_USER_CREDENTIALS);
            trace.error(exception.getMessage());
            throw new CorsErrorResponseException(cors, OAuthErrorException.INVALID_GRANT, exception.getMessage(), Response.Status.BAD_REQUEST);
        }
    }

    @Override
    public EventType getEventType() {
        return EventType.LOGIN;
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        return second != null && !second.isBlank() ? second : null;
    }

}

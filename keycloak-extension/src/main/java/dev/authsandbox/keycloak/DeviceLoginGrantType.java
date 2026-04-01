package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.Response;
import org.keycloak.OAuthErrorException;
import org.keycloak.credential.CredentialModel;
import org.keycloak.events.Details;
import org.keycloak.events.Errors;
import org.keycloak.events.EventType;
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
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

public class DeviceLoginGrantType extends OAuth2GrantTypeBase {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String LOGIN_TOKEN_PARAM = "login_token";
    private static final String DEVICE_LOGIN_ACR = "2se";

    @Override
    public Response process(Context context) {
        setContext(context);
        event.detail(Details.AUTH_METHOD, "device_grant");

        if (client.isBearerOnly() || client.isPublicClient()) {
            String errorMessage = "Client not allowed to use device login grant";
            event.detail(Details.REASON, errorMessage);
            event.error(Errors.NOT_ALLOWED);
            throw new CorsErrorResponseException(cors, OAuthErrorException.UNAUTHORIZED_CLIENT, errorMessage, Response.Status.BAD_REQUEST);
        }

        if (client.isConsentRequired()) {
            String errorMessage = "Client requires user consent";
            event.detail(Details.REASON, errorMessage);
            event.error(Errors.CONSENT_DENIED);
            throw new CorsErrorResponseException(cors, OAuthErrorException.INVALID_CLIENT, errorMessage, Response.Status.BAD_REQUEST);
        }

        String loginToken = formParams.getFirst(LOGIN_TOKEN_PARAM);
        if (loginToken == null || loginToken.isBlank()) {
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

            event.user(user);
            event.detail(Details.USERNAME, user.getUsername());

            if (!user.isEnabled()) {
                throw new IllegalArgumentException("User disabled");
            }

            if (user.getRequiredActionsStream().findAny().isPresent()) {
                throw new IllegalArgumentException("Account is not fully set up");
            }

            CredentialModel matchedCredential = user.credentialManager()
                    .getStoredCredentialsByTypeStream(DeviceCredentialModel.TYPE)
                    .filter((credential) -> payload.publicKeyHash().equals(DeviceCredentialModel.createFromCredentialModel(credential).getPublicKeyHash()))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Device credential not found"));

            validateSignature(matchedCredential, payload.encryptedData(), payload.signature());

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

            AuthenticationManager.setClientScopesInSession(session, authSession);
            authSession.setAuthNote("acr", DEVICE_LOGIN_ACR);
            authSession.setUserSessionNote("acr", DEVICE_LOGIN_ACR);
            userSession.setNote("acr", DEVICE_LOGIN_ACR);
            ClientSessionContext clientSessionCtx = TokenManager.attachAuthenticationSession(session, userSession, authSession);
            clientSessionCtx.setAttribute(Constants.GRANT_TYPE, context.getGrantType());
            updateUserSessionFromClientAuth(userSession);

            TokenManager.AccessTokenResponseBuilder responseBuilder = createTokenResponseBuilder(user, userSession, clientSessionCtx, scope, null);
            return createTokenResponse(responseBuilder, clientSessionCtx, true);
        } catch (CorsErrorResponseException exception) {
            throw exception;
        } catch (Exception exception) {
            event.detail(Details.REASON, exception.getMessage());
            event.error(Errors.INVALID_USER_CREDENTIALS);
            throw new CorsErrorResponseException(cors, OAuthErrorException.INVALID_GRANT, exception.getMessage(), Response.Status.BAD_REQUEST);
        }
    }

    @Override
    public EventType getEventType() {
        return EventType.LOGIN;
    }

    private void validateSignature(CredentialModel credential, String encryptedData, String signature) throws Exception {
        DeviceCredentialModel deviceCredential = DeviceCredentialModel.createFromCredentialModel(credential);
        PublicKey publicKey = readPublicKey(deviceCredential.getPublicKey());
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(publicKey);
        verifier.update(Base64.getDecoder().decode(encryptedData));
        boolean valid = verifier.verify(Base64.getDecoder().decode(signature));

        if (!valid) {
            throw new IllegalArgumentException("Invalid device signature");
        }
    }

    private PublicKey readPublicKey(String pem) throws Exception {
        String body = pem
                .replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s+", "");
        byte[] decoded = Base64.getDecoder().decode(body);
        return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(decoded));
    }

}

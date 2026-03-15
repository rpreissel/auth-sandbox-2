package dev.authsandbox.keycloak;

import jakarta.ws.rs.core.Response;
import org.keycloak.OAuthErrorException;
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

public class AssuranceHandleGrantType extends OAuth2GrantTypeBase {

    private static final String ASSURANCE_HANDLE_PARAM = "assurance_handle";
    private static final String REFRESH_TOKEN_PARAM = "refresh_token";

    @Override
    public Response process(Context context) {
        setContext(context);
        event.detail(Details.AUTH_METHOD, "assurance_handle_grant");

        if (client.isBearerOnly() || client.isPublicClient()) {
            throw new CorsErrorResponseException(cors, OAuthErrorException.UNAUTHORIZED_CLIENT, "Client not allowed to use assurance handle grant", Response.Status.BAD_REQUEST);
        }

        String assuranceHandle = formParams.getFirst(ASSURANCE_HANDLE_PARAM);
        if (assuranceHandle == null || assuranceHandle.isBlank()) {
            throw new CorsErrorResponseException(cors, OAuthErrorException.INVALID_REQUEST, "Missing parameter: " + ASSURANCE_HANDLE_PARAM, Response.Status.BAD_REQUEST);
        }

        try {
            AuthApiClient.FlowArtifactRedeemResult redeem = new AuthApiClient().redeemArtifact(assuranceHandle, "assurance_handle");
            UserModel user = session.users().getUserByUsername(realm, redeem.userId());
            if (user == null) {
                throw new IllegalArgumentException("User not found");
            }

            event.user(user);
            event.detail(Details.USERNAME, user.getUsername());

            RootAuthenticationSessionModel rootAuthSession = new AuthenticationSessionManager(session).createAuthenticationSession(realm, false);
            AuthenticationSessionModel authSession = rootAuthSession.createAuthenticationSession(client);
            authSession.setAuthenticatedUser(user);
            authSession.setProtocol(OIDCLoginProtocol.LOGIN_PROTOCOL);
            authSession.setClientNote(OIDCLoginProtocol.ISSUER, Urls.realmIssuer(session.getContext().getUri().getBaseUri(), realm.getName()));
            authSession.setClientNote(OIDCLoginProtocol.SCOPE_PARAM, getRequestedScopes());

            String existingRefreshToken = formParams.getFirst(REFRESH_TOKEN_PARAM);
            UserSessionModel userSession = new UserSessionManager(session).createUserSession(
                    authSession.getParentSession().getId(),
                    realm,
                    user,
                    user.getUsername(),
                    clientConnection.getRemoteHost(),
                    existingRefreshToken == null || existingRefreshToken.isBlank() ? "assurance-handle-grant" : "assurance-handle-refresh-upgrade",
                    false,
                    null,
                    null,
                    UserSessionModel.SessionPersistenceState.PERSISTENT
            );
            userSession.setNote("auth_time", redeem.authTime());
            if (redeem.achievedAcr() != null) {
                userSession.setNote("acr", redeem.achievedAcr());
            }
            if (!redeem.amr().isEmpty()) {
                userSession.setNote("amr", String.join(" ", redeem.amr()));
            }
            event.session(userSession);

            AuthenticationManager.setClientScopesInSession(session, authSession);
            ClientSessionContext clientSessionCtx = TokenManager.attachAuthenticationSession(session, userSession, authSession);
            clientSessionCtx.setAttribute(Constants.GRANT_TYPE, context.getGrantType());
            updateUserSessionFromClientAuth(userSession);

            TokenManager.AccessTokenResponseBuilder responseBuilder = createTokenResponseBuilder(user, userSession, clientSessionCtx, getRequestedScopes(), null);
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
}

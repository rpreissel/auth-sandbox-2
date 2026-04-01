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

import java.util.Map;

public class AssuranceHandleGrantType extends OAuth2GrantTypeBase {

    private static final String ASSURANCE_HANDLE_PARAM = "assurance_handle";
    private static final String REFRESH_TOKEN_PARAM = "refresh_token";

    @Override
    public Response process(Context context) {
        setContext(context);
        event.detail(Details.AUTH_METHOD, "assurance_handle_grant");
        String existingRefreshToken = formParams.getFirst(REFRESH_TOKEN_PARAM);
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
                AssuranceHandleGrantTypeFactory.GRANT_TYPE,
                "assurance_handle_grant",
                null,
                false,
                true,
                existingRefreshToken != null && !existingRefreshToken.isBlank()
        );

        if (client.isBearerOnly() || client.isPublicClient()) {
            trace.error("Client not allowed to use assurance handle grant");
            throw new CorsErrorResponseException(cors, OAuthErrorException.UNAUTHORIZED_CLIENT, "Client not allowed to use assurance handle grant", Response.Status.BAD_REQUEST);
        }

        String assuranceHandle = formParams.getFirst(ASSURANCE_HANDLE_PARAM);
        if (assuranceHandle == null || assuranceHandle.isBlank()) {
            trace.error("Missing parameter: " + ASSURANCE_HANDLE_PARAM);
            throw new CorsErrorResponseException(cors, OAuthErrorException.INVALID_REQUEST, "Missing parameter: " + ASSURANCE_HANDLE_PARAM, Response.Status.BAD_REQUEST);
        }

        try {
            AuthApiClient.FlowArtifactRedeemResult redeem = new AuthApiClient().redeemArtifact(assuranceHandle, "assurance_handle", trace.outboundContext());
            UserModel user = session.users().getUserByUsername(realm, redeem.userId());
            if (user == null) {
                throw new IllegalArgumentException("User not found");
            }
            trace.updateResolvedUser(user.getUsername(), user.getId());
            trace.updateAssurance(redeem.achievedAcr(), redeem.amr());
            trace.recordArtifact("assurance_handle_redeem", Map.of(
                    "userId", redeem.userId(),
                    "flowId", redeem.flowId(),
                    "purpose", redeem.purpose(),
                    "achievedAcr", redeem.achievedAcr(),
                    "amr", redeem.amr(),
                    "usedRefreshToken", existingRefreshToken != null && !existingRefreshToken.isBlank()
            ), "Redeemed assurance handle for token endpoint processing.");

            event.user(user);
            event.detail(Details.USERNAME, user.getUsername());

            RootAuthenticationSessionModel rootAuthSession = new AuthenticationSessionManager(session).createAuthenticationSession(realm, false);
            AuthenticationSessionModel authSession = rootAuthSession.createAuthenticationSession(client);
            authSession.setAuthenticatedUser(user);
            authSession.setProtocol(OIDCLoginProtocol.LOGIN_PROTOCOL);
            authSession.setClientNote(OIDCLoginProtocol.ISSUER, Urls.realmIssuer(session.getContext().getUri().getBaseUri(), realm.getName()));
            authSession.setClientNote(OIDCLoginProtocol.SCOPE_PARAM, getRequestedScopes());

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
            trace.updateSessions(authSession.getParentSession().getId(), userSession.getId());
            trace.refreshContextArtifact();

            AuthenticationManager.setClientScopesInSession(session, authSession);
            ClientSessionContext clientSessionCtx = TokenManager.attachAuthenticationSession(session, userSession, authSession);
            clientSessionCtx.setAttribute(Constants.GRANT_TYPE, context.getGrantType());
            updateUserSessionFromClientAuth(userSession);

            TokenManager.AccessTokenResponseBuilder responseBuilder = createTokenResponseBuilder(user, userSession, clientSessionCtx, getRequestedScopes(), null);
            trace.success("Completed assurance-handle grant token issuance.");
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

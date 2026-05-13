package dev.authsandbox.keycloak;

import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.services.managers.AuthenticationManager;

import java.util.Map;

public class EkwSessionReuseGuardAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(EkwSessionReuseGuardAuthenticator.class);

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        AuthFlowTraceSupport.AuthenticatorTrace trace = AuthFlowTraceSupport.start(context, EkwSessionReuseGuardAuthenticatorFactory.PROVIDER_ID, "authenticate");
        try {
            AuthenticationManager.AuthResult authResult = AuthenticationManager.authenticateIdentityCookie(context.getSession(), context.getRealm(), true);
            String requestedAcrValues = context.getAuthenticationSession().getClientNote("acr_values");
            if (requestedAcrValues == null || requestedAcrValues.isBlank()) {
                requestedAcrValues = context.getHttpRequest().getUri().getQueryParameters().getFirst("acr_values");
            }
            boolean requestedEkw = requestedAcrValues != null && requestedAcrValues.contains("ekw");
            boolean ekwHandoff = "1".equals(context.getHttpRequest().getUri().getQueryParameters().getFirst("ekw_handoff"));
            boolean enforceEkw = requestedEkw || ekwHandoff;
            if (authResult == null) {
                trace.success("No active cookie session found for EKW guard.");
                context.success();
                return;
            }

            UserSessionModel userSession = authResult.getSession();
            if (!"true".equals(userSession.getNote(EkwSessionArmAuthenticator.EKW_MARKER_NOTE))) {
                if (enforceEkw) {
                    reject(context, trace, "none".equals(context.getAuthenticationSession().getClientNote("prompt")), "Requested acr=ekw but cookie session is not an EKW session.");
                    return;
                }
                trace.success("Current session is not an EKW session.");
                context.success();
                return;
            }

            String currentClientId = context.getAuthenticationSession().getClient() != null
                    ? context.getAuthenticationSession().getClient().getClientId()
                    : null;
            String allowedTargetClientId = userSession.getNote(EkwSessionArmAuthenticator.EKW_TARGET_CLIENT_ID_NOTE);
            String consumed = userSession.getNote(EkwSessionArmAuthenticator.EKW_CONSUMED_NOTE);
            boolean promptNone = "none".equals(context.getAuthenticationSession().getClientNote("prompt"));

            trace.recordArtifact("ekw_session_guard", Map.of(
                    "currentClientId", currentClientId == null ? "" : currentClientId,
                    "allowedTargetClientId", allowedTargetClientId == null ? "" : allowedTargetClientId,
                    "consumed", consumed == null ? "" : consumed,
                    "promptNone", promptNone
            ), "Validated whether an attached cookie session may still be reused as a single-use EKW session.");

            if (allowedTargetClientId == null || allowedTargetClientId.isBlank()) {
                reject(context, trace, promptNone, "EKW session missing allowed target client.");
                return;
            }
            if (!allowedTargetClientId.equals(currentClientId)) {
                reject(context, trace, promptNone, "EKW session attempted on a different client.");
                return;
            }
            if ("true".equals(consumed)) {
                reject(context, trace, promptNone, "EKW session was already consumed.");
                return;
            }

            userSession.setNote(EkwSessionArmAuthenticator.EKW_CONSUMED_NOTE, "true");
            trace.success("Allowed the one permitted EKW cookie reuse for the configured target client.");
            context.success();
        } catch (Exception exception) {
            LOG.warnf(exception, "EKW session reuse guard failed");
            trace.error(exception.getMessage());
            context.failure(AuthenticationFlowError.INTERNAL_ERROR);
        }
    }

    private void reject(AuthenticationFlowContext context, AuthFlowTraceSupport.AuthenticatorTrace trace, boolean promptNone, String reason) {
        if (promptNone) {
            trace.error(reason + " prompt=none request rejected after cookie authentication.");
            context.failure(AuthenticationFlowError.ACCESS_DENIED);
            return;
        }

        Response response = context.form()
                .setError("Die EKW-Session darf fuer diesen Client nicht mehr per Cookie-SSO wiederverwendet werden.")
                .createErrorPage(Response.Status.UNAUTHORIZED);
        trace.error(reason + " interactive request rejected after cookie authentication.");
        context.failure(AuthenticationFlowError.ACCESS_DENIED, response);
    }

    @Override
    public void action(AuthenticationFlowContext context) {
    }

    @Override
    public boolean requiresUser() {
        return false;
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
    }

    @Override
    public void close() {
    }
}

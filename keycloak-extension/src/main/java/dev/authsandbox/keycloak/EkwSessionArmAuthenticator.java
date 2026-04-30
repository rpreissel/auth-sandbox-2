package dev.authsandbox.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

import java.util.Map;

public class EkwSessionArmAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(EkwSessionArmAuthenticator.class);
    static final String LOGIN_KIND_NOTE = "auth_sandbox.login_kind";
    static final String EKW_TARGET_CLIENT_ID_NOTE = "auth_sandbox.ekw_target_client_id";
    static final String EKW_CONSUMED_NOTE = "auth_sandbox.ekw_consumed";
    static final String EKW_MARKER_NOTE = "auth_sandbox.ekw";
    private static final String ACR = "ekw";

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        AuthFlowTraceSupport.AuthenticatorTrace trace = AuthFlowTraceSupport.start(context, EkwSessionArmAuthenticatorFactory.PROVIDER_ID, "authenticate");
        try {
            if ("true".equals(context.getAuthenticationSession().getAuthNote("SSO_AUTH"))) {
                trace.success("Skipped EKW session arming for an existing SSO session.");
                context.success();
                return;
            }

            UserModel user = context.getUser() != null ? context.getUser() : context.getAuthenticationSession().getAuthenticatedUser();
            if (user == null) {
                trace.success("No authenticated user available yet; skipped EKW session arming.");
                context.success();
                return;
            }

            String targetClientId = user.getFirstAttribute("allowed_target_client_id");
            if (targetClientId == null || targetClientId.isBlank()) {
                LOG.warnf("No allowed_target_client_id attribute found for user '%s'", user.getUsername());
                trace.success("Missing allowed_target_client_id attribute; skipped EKW session arming.");
                context.success();
                return;
            }

            context.getAuthenticationSession().setAuthNote("acr", ACR);
            context.getAuthenticationSession().setUserSessionNote("acr", ACR);
            context.getAuthenticationSession().setUserSessionNote(LOGIN_KIND_NOTE, ACR);
            context.getAuthenticationSession().setUserSessionNote(EKW_MARKER_NOTE, "true");
            context.getAuthenticationSession().setUserSessionNote(EKW_TARGET_CLIENT_ID_NOTE, targetClientId);
            context.getAuthenticationSession().setUserSessionNote(EKW_CONSUMED_NOTE, "false");
            context.getAuthenticationSession().removeAuthNote("loa-map");
            trace.recordArtifact("ekw_session_arm", Map.of(
                    "userId", user.getUsername(),
                    "targetClientId", targetClientId,
                    "acr", ACR
            ), "Marked the freshly established brokered session as a single-use EKW session.");
            trace.success("Armed EKW session notes for the broker login flow.");
            context.success();
        } catch (Exception exception) {
            LOG.warnf(exception, "Failed to arm EKW session");
            trace.error(exception.getMessage());
            context.success();
        }
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

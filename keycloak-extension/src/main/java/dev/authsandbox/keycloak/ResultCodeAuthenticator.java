package dev.authsandbox.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

public class ResultCodeAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(ResultCodeAuthenticator.class);
    private static final String RESULT_CODE_NOTE = "client_request_param_result_code";

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        try {
            String resultCode = context.getAuthenticationSession().getClientNote(RESULT_CODE_NOTE);
            if (resultCode == null || resultCode.isBlank()) {
                resultCode = context.getAuthenticationSession().getClientNote("result_code");
            }
            if (resultCode == null || resultCode.isBlank()) {
                resultCode = context.getHttpRequest().getUri().getQueryParameters().getFirst("result_code");
            }
            if (resultCode == null || resultCode.isBlank()) {
                LOG.warn("No result_code found in auth session notes");
                context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
                return;
            }

            AuthApiClient.FlowArtifactRedeemResult redeem = new AuthApiClient().redeemArtifact(resultCode, "result_code");
            UserModel user = context.getSession().users().getUserByUsername(context.getRealm(), redeem.userId());
            if (user == null) {
                LOG.warnf("No Keycloak user found for result code user '%s'", redeem.userId());
                context.failure(AuthenticationFlowError.INVALID_USER);
                return;
            }

            context.getAuthenticationSession().setAuthNote("acr", redeem.achievedAcr());
            context.getAuthenticationSession().setAuthNote("auth_time", redeem.authTime());
            context.getAuthenticationSession().setUserSessionNote("acr", redeem.achievedAcr());
            context.getAuthenticationSession().setUserSessionNote("auth_time", redeem.authTime());
            context.getAuthenticationSession().setClientNote(RESULT_CODE_NOTE, resultCode);
            context.getAuthenticationSession().setClientNote("result_code", resultCode);
            if (!redeem.amr().isEmpty()) {
                context.getAuthenticationSession().setAuthNote("amr", String.join(" ", redeem.amr()));
                context.getAuthenticationSession().setUserSessionNote("amr", String.join(" ", redeem.amr()));
            }

            context.setUser(user);
            context.success();
        } catch (Exception exception) {
            LOG.warnf(exception, "Result code validation failed");
            context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
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

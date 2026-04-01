package dev.authsandbox.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.authenticators.util.AcrStore;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

import java.util.Map;

public class ResultCodeAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(ResultCodeAuthenticator.class);
    private static final String RESULT_CODE_NOTE = "client_request_param_result_code";

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        AuthFlowTraceSupport.AuthenticatorTrace trace = AuthFlowTraceSupport.start(context, ResultCodeAuthenticatorFactory.PROVIDER_ID, "authenticate");
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
                trace.error("No result_code found in auth session notes.");
                context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
                return;
            }

            AuthApiClient.FlowArtifactRedeemResult redeem = new AuthApiClient().redeemArtifact(resultCode, "result_code", trace.outboundContext());
            UserModel user = context.getSession().users().getUserByUsername(context.getRealm(), redeem.userId());
            if (user == null) {
                LOG.warnf("No Keycloak user found for result code user '%s'", redeem.userId());
                trace.error("No Keycloak user found for redeemed result_code user.");
                context.failure(AuthenticationFlowError.INVALID_USER);
                return;
            }

            trace.recordArtifact("result_code_redeem", Map.of(
                    "userId", redeem.userId(),
                    "flowId", redeem.flowId(),
                    "purpose", redeem.purpose(),
                    "achievedAcr", redeem.achievedAcr(),
                    "amr", redeem.amr()
            ), "Redeemed result_code and mapped it to a Keycloak user.");

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
            recordLevelOfAuthentication(context, redeem.achievedAcr());

            context.setUser(user);
            trace.success("Redeemed result_code and completed Keycloak authentication.");
            context.success();
        } catch (Exception exception) {
            LOG.warnf(exception, "Result code validation failed");
            trace.error(exception.getMessage());
            context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
        }
    }

    private void recordLevelOfAuthentication(AuthenticationFlowContext context, String achievedAcr) {
        int level = switch (achievedAcr) {
            case "2se" -> 2;
            case "1se" -> 1;
            default -> -1;
        };
        if (level < 0) {
            return;
        }

        AcrStore acrStore = new AcrStore(context.getSession(), context.getAuthenticationSession());
        acrStore.setLevelAuthenticated(level);

        String loaMap = context.getAuthenticationSession().getAuthNote("loa-map");
        if (loaMap != null) {
            context.getAuthenticationSession().setUserSessionNote("loa-map", loaMap);
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

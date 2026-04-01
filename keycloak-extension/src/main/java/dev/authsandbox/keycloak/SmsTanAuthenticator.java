package dev.authsandbox.keycloak;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

import java.util.Map;

public class SmsTanAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(SmsTanAuthenticator.class);
    private static final String LOGIN_HINT_NOTE = "client_request_param_login_hint";
    private static final String FLOW_ID_NOTE = "sms_tan_flow_id";
    private static final String SERVICE_TOKEN_NOTE = "sms_tan_service_token";
    private static final String MASKED_TARGET_NOTE = "sms_tan_masked_target";
    private static final String DEV_CODE_NOTE = "sms_tan_dev_code";

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        AuthFlowTraceSupport.AuthenticatorTrace trace = AuthFlowTraceSupport.start(context, SmsTanAuthenticatorFactory.PROVIDER_ID, "authenticate");
        try {
            UserModel user = context.getUser() != null ? context.getUser() : context.getAuthenticationSession().getAuthenticatedUser();
            if (user == null) {
                String loginHint = context.getAuthenticationSession().getClientNote(LOGIN_HINT_NOTE);
                if (loginHint == null || loginHint.isBlank()) {
                    loginHint = context.getHttpRequest().getUri().getQueryParameters().getFirst("login_hint");
                }
                if (loginHint != null && !loginHint.isBlank()) {
                    user = context.getSession().users().getUserByUsername(context.getRealm(), loginHint);
                    if (user != null) {
                        context.setUser(user);
                        context.getAuthenticationSession().setAuthenticatedUser(user);
                    }
                }
            }

            if (user == null) {
                trace.error("No Keycloak user available for SMS-TAN step-up.");
                context.failure(AuthenticationFlowError.INVALID_USER);
                return;
            }

            AuthApiClient.BrowserSmsChallenge challenge = new AuthApiClient().startBrowserStepUp(user.getUsername(), trace.outboundContext());
            trace.recordArtifact("sms_tan_challenge", Map.of(
                    "userId", user.getUsername(),
                    "flowId", challenge.flowId(),
                    "maskedTarget", challenge.maskedTarget(),
                    "hasServiceToken", challenge.serviceToken() != null && !challenge.serviceToken().isBlank(),
                    "hasDevCode", challenge.devCode() != null && !challenge.devCode().isBlank()
            ), "Started browser step-up challenge for the SMS-TAN authenticator.");
            context.getAuthenticationSession().setAuthNote(FLOW_ID_NOTE, challenge.flowId());
            context.getAuthenticationSession().setAuthNote(SERVICE_TOKEN_NOTE, challenge.serviceToken());
            if (challenge.maskedTarget() != null) {
                context.getAuthenticationSession().setAuthNote(MASKED_TARGET_NOTE, challenge.maskedTarget());
            }
            if (challenge.devCode() != null) {
                context.getAuthenticationSession().setAuthNote(DEV_CODE_NOTE, challenge.devCode());
            }
            trace.success("Started SMS-TAN browser challenge.");
            context.challenge(createChallenge(context, null));
        } catch (Exception exception) {
            LOG.warnf(exception, "SMS-TAN authenticator start failed");
            trace.error(exception.getMessage());
            context.failure(AuthenticationFlowError.INTERNAL_ERROR);
        }
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        AuthFlowTraceSupport.AuthenticatorTrace trace = AuthFlowTraceSupport.start(context, SmsTanAuthenticatorFactory.PROVIDER_ID, "action");
        try {
            MultivaluedMap<String, String> formParams = context.getHttpRequest().getDecodedFormParameters();
            String tan = formParams.getFirst("smsTan");
            if (tan == null || tan.isBlank()) {
                trace.error("SMS-TAN form submission missing TAN value.");
                context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS, createChallenge(context, "Bitte gib die SMS-TAN ein."));
                return;
            }

            String flowId = context.getAuthenticationSession().getAuthNote(FLOW_ID_NOTE);
            String serviceToken = context.getAuthenticationSession().getAuthNote(SERVICE_TOKEN_NOTE);
            if (flowId == null || flowId.isBlank() || serviceToken == null || serviceToken.isBlank()) {
                trace.error("Missing flowId or serviceToken in authentication session notes.");
                context.failure(AuthenticationFlowError.INVALID_CLIENT_SESSION);
                return;
            }

            trace.recordArtifact("sms_tan_submission", Map.of(
                    "flowId", flowId,
                    "hasServiceToken", true,
                    "hasTan", true
            ), "Submitted SMS-TAN verification through auth-api.");
            new AuthApiClient().completeBrowserStepUp(flowId, serviceToken, tan.trim(), trace.outboundContext());
            trace.success("Completed SMS-TAN verification and returned success to Keycloak.");
            context.success();
        } catch (Exception exception) {
            LOG.warnf(exception, "SMS-TAN authenticator verification failed");
            trace.error(exception.getMessage());
            context.failureChallenge(AuthenticationFlowError.INVALID_CREDENTIALS, createChallenge(context, "Die SMS-TAN war ungültig oder abgelaufen."));
        }
    }

    private Response createChallenge(AuthenticationFlowContext context, String errorMessage) {
        var form = context.form()
                .setAuthenticationSession(context.getAuthenticationSession())
                .setAuthContext(context)
                .setAttribute("maskedTarget", context.getAuthenticationSession().getAuthNote(MASKED_TARGET_NOTE))
                .setAttribute("demoTan", context.getAuthenticationSession().getAuthNote(DEV_CODE_NOTE));
        if (errorMessage != null) {
            form.setError(errorMessage);
        }
        return form.createForm("sms-tan.ftl");
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

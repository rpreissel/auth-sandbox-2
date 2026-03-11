package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

public class DeviceLoginConditionAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(DeviceLoginConditionAuthenticator.class);
    private static final String LOGIN_TOKEN_NOTE = "client_request_param_login_token";
    private static final ObjectMapper mapper = new ObjectMapper();

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        String loginToken = context.getAuthenticationSession().getClientNote(LOGIN_TOKEN_NOTE);

        if (loginToken == null || loginToken.isBlank()) {
            LOG.warn("No login_token found - condition not met");
            context.getExecution().setRequirement(AuthenticationExecutionModel.Requirement.DISABLED);
            context.success();
            return;
        }

        try {
            String json = new String(Base64.getUrlDecoder().decode(loginToken), StandardCharsets.UTF_8);
            @SuppressWarnings("unchecked")
            Map<String, Object> token = mapper.readValue(json, Map.class);
            if ("device".equals(token.get("type"))) {
                LOG.info("Device login condition met - token type is 'device'");
                context.success();
            } else {
                LOG.warnf("Device login condition not met - token type is '%s'", token.get("type"));
                context.getExecution().setRequirement(AuthenticationExecutionModel.Requirement.DISABLED);
                context.success();
            }
        } catch (Exception e) {
            LOG.warnf(e, "Failed to parse login_token - condition not met");
            context.getExecution().setRequirement(AuthenticationExecutionModel.Requirement.DISABLED);
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

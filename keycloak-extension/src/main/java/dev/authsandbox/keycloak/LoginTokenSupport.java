package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.keycloak.models.DefaultActionTokenKey;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.SingleUseObjectProvider;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

final class LoginTokenSupport {

    static final String LOGIN_TOKEN_REQUEST_NOTE = "client_request_param_login_token";
    static final String LOGIN_TOKEN_ACTION = "auth-sandbox-2-login-token";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private LoginTokenSupport() {
    }

    static String resolveLoginToken(org.keycloak.authentication.AuthenticationFlowContext context) {
        String loginToken = context.getAuthenticationSession().getClientNote(LOGIN_TOKEN_REQUEST_NOTE);
        String source = LOGIN_TOKEN_REQUEST_NOTE;
        if (loginToken == null || loginToken.isBlank()) {
            loginToken = context.getAuthenticationSession().getClientNote("login_token");
            source = "clientNote:login_token";
        }
        if (loginToken == null || loginToken.isBlank()) {
            loginToken = context.getAuthenticationSession().getAuthNote("login_token");
            source = "authNote:login_token";
        }
        if (loginToken == null || loginToken.isBlank()) {
            loginToken = context.getHttpRequest().getUri().getQueryParameters().getFirst("login_token");
            source = "query:login_token";
        }
        if (loginToken == null || loginToken.isBlank()) {
            DeviceLoginTokenAuthenticator.LOG.info("Device login flow found no login_token in auth session or request");
        } else {
            DeviceLoginTokenAuthenticator.LOG.infof("Device login flow resolved login_token from %s", source);
        }
        return loginToken;
    }

    static DeviceLoginPayload parseLoginToken(String loginToken) throws Exception {
        String json = new String(Base64.getUrlDecoder().decode(loginToken), StandardCharsets.UTF_8);
        @SuppressWarnings("unchecked")
        Map<String, Object> token = MAPPER.readValue(json, Map.class);

        Object expValue = token.get("exp");
        long exp;
        if (expValue instanceof Number number) {
            exp = number.longValue();
        } else {
            throw new IllegalArgumentException("login_token exp missing");
        }

        String jti = readRequiredString(token, "jti");
        UUID parsedJti;
        try {
            parsedJti = UUID.fromString(jti);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("login_token jti invalid", exception);
        }

        return new DeviceLoginPayload(
                readRequiredString(token, "type"),
                readRequiredString(token, "sub"),
                readOptionalString(token, "acr"),
                readRequiredString(token, "publicKeyHash"),
                readRequiredString(token, "encryptedData"),
                readRequiredString(token, "signature"),
                exp,
                parsedJti
        );
    }

    static void validateExpiry(DeviceLoginPayload payload) {
        long now = Instant.now().getEpochSecond();
        if (payload.exp() <= now) {
            throw new IllegalArgumentException("login_token expired");
        }
    }

    static boolean markSingleUse(KeycloakSession session, DeviceLoginPayload payload) {
        DefaultActionTokenKey key = new DefaultActionTokenKey(payload.sub(), LOGIN_TOKEN_ACTION, Math.toIntExact(payload.exp()), payload.jti());
        SingleUseObjectProvider singleUse = session.singleUseObjects();
        return singleUse.putIfAbsent(key.serializeKey(), payload.exp());
    }

    private static String readRequiredString(Map<String, Object> token, String fieldName) {
        Object value = token.get(fieldName);
        if (!(value instanceof String stringValue) || stringValue.isBlank()) {
            throw new IllegalArgumentException("login_token " + fieldName + " missing");
        }
        return stringValue;
    }

    private static String readOptionalString(Map<String, Object> token, String fieldName) {
        Object value = token.get(fieldName);
        if (value instanceof String stringValue && !stringValue.isBlank()) {
            return stringValue;
        }
        return null;
    }

    record DeviceLoginPayload(
            String type,
            String sub,
            String acr,
            String publicKeyHash,
            String encryptedData,
            String signature,
            long exp,
            UUID jti
    ) {
    }
}

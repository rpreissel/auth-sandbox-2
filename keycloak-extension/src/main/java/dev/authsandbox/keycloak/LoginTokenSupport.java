package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.keycloak.models.DefaultActionTokenKey;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.SingleUseObjectProvider;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

final class LoginTokenSupport {

    static final String LOGIN_TOKEN_REQUEST_NOTE = "client_request_param_login_token";
    static final String LOGIN_TOKEN_ACTION = "auth-sandbox-2-login-token";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final SecureRandom RANDOM = new SecureRandom();

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

        String handoverIv = readRequiredString(token, "handoverIv");
        String handoverCiphertext = readRequiredString(token, "handoverCiphertext");

        return new DeviceLoginPayload(
                readRequiredString(token, "type"),
                readRequiredString(token, "sub"),
                readOptionalString(token, "acr"),
                readRequiredString(token, "publicKeyHash"),
                readRequiredString(token, "nonce"),
                handoverIv,
                handoverCiphertext,
                exp,
                parsedJti,
                readSecondFactor(token)
        );
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> readSecondFactor(Map<String, Object> token) {
        Object sf = token.get("secondFactor");
        if (sf instanceof Map) {
            return (Map<String, Object>) sf;
        }
        return null;
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

    static EncryptedHandoverPayload decryptHandover(DeviceLoginPayload outer, String handoverSecret) {
        try {
            byte[] secretBytes = Base64.getUrlDecoder().decode(handoverSecret);
            byte[] iv = Base64.getUrlDecoder().decode(outer.handoverIv());
            byte[] ciphertext = Base64.getUrlDecoder().decode(outer.handoverCiphertext());

            byte[] tag = new byte[GCM_TAG_LENGTH / 8];
            byte[] encrypted = new byte[ciphertext.length - tag.length];
            System.arraycopy(ciphertext, ciphertext.length - tag.length, tag, 0, tag.length);
            System.arraycopy(ciphertext, 0, encrypted, 0, encrypted.length);

            SecretKeySpec keySpec = new SecretKeySpec(secretBytes, "AES");
            GCMParameterSpec gcmSpec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec);
            cipher.update(encrypted);
            byte[] decrypted = cipher.doFinal(tag);

            String innerJson = new String(decrypted, StandardCharsets.UTF_8);
            @SuppressWarnings("unchecked")
            Map<String, Object> inner = MAPPER.readValue(innerJson, Map.class);

            return new EncryptedHandoverPayload(
                    readRequiredString(inner, "type"),
                    readRequiredString(inner, "sub"),
                    readRequiredString(inner, "publicKeyHash"),
                    readRequiredString(inner, "nonce"),
                    ((Number) inner.get("exp")).longValue(),
                    readRequiredString(inner, "jti"),
                    readOptionalString(inner, "acr")
            );
        } catch (Exception exception) {
            throw new RuntimeException("Failed to decrypt handover payload", exception);
        }
    }

    static void validateHandoverCrossCheck(DeviceLoginPayload outer, EncryptedHandoverPayload inner) {
        List<String> errors = new java.util.ArrayList<>();
        if (!outer.type().equals(inner.type())) errors.add("type mismatch");
        if (!outer.sub().equals(inner.sub())) errors.add("sub mismatch");
        if (!outer.publicKeyHash().equals(inner.publicKeyHash())) errors.add("publicKeyHash mismatch");
        if (!String.valueOf(outer.exp()).equals(String.valueOf(inner.exp()))) errors.add("exp mismatch");
        if (!outer.jti().toString().equals(inner.jti())) errors.add("jti mismatch");
        if (!java.util.Objects.equals(outer.acr(), inner.acr())) errors.add("acr mismatch");
        if (!errors.isEmpty()) {
            throw new IllegalArgumentException("Handover cross-check failed: " + String.join(", ", errors));
        }
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
            String nonce,
            String handoverIv,
            String handoverCiphertext,
            long exp,
            UUID jti,
            Map<String, Object> secondFactor
    ) {
    }

    record EncryptedHandoverPayload(
            String type,
            String sub,
            String publicKeyHash,
            String nonce,
            long exp,
            String jti,
            String acr
    ) {
    }
}
package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.credential.CredentialModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserCredentialModel;
import org.keycloak.models.UserModel;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.Map;

public class DeviceLoginTokenAuthenticator implements Authenticator {

    private static final Logger LOG = Logger.getLogger(DeviceLoginTokenAuthenticator.class);
    private static final String LOGIN_TOKEN_NOTE = "client_request_param_login_token";
    private static final ObjectMapper mapper = new ObjectMapper();

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        try {
            String loginToken = context.getAuthenticationSession().getClientNote(LOGIN_TOKEN_NOTE);
            if (loginToken == null || loginToken.isBlank()) {
                LOG.warn("No login_token found in auth session notes");
                context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
                return;
            }

            String json = new String(Base64.getUrlDecoder().decode(loginToken), StandardCharsets.UTF_8);
            @SuppressWarnings("unchecked")
            Map<String, String> token = mapper.readValue(json, Map.class);

            String userId = token.get("sub");
            String publicKeyHash = token.get("publicKeyHash");
            String encryptedData = token.get("encryptedData");
            String signature = token.get("signature");

            LOG.infof("Device login token received for user '%s' and publicKeyHash '%s'", userId, publicKeyHash);

            UserModel user = context.getSession().users().getUserByUsername(context.getRealm(), userId);
            if (user == null) {
                LOG.warnf("No Keycloak user found for device login user '%s'", userId);
                context.failure(AuthenticationFlowError.INVALID_USER);
                return;
            }

            var credentials = user.credentialManager().getStoredCredentialsByTypeStream(DeviceCredentialModel.TYPE).toList();
            CredentialModel matched = credentials.stream().filter(credential -> {
                DeviceCredentialModel model = DeviceCredentialModel.createFromCredentialModel(credential);
                return publicKeyHash.equals(model.getPublicKeyHash());
            }).findFirst().orElse(null);

            if (matched == null) {
                LOG.warnf("No device credential matched publicKeyHash '%s' for user '%s'", publicKeyHash, userId);
                context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
                return;
            }

            DeviceCredentialModel deviceCredential = DeviceCredentialModel.createFromCredentialModel(matched);
            PublicKey publicKey = readPublicKey(deviceCredential.getPublicKey());
            Signature verifier = Signature.getInstance("SHA256withRSA");
            verifier.initVerify(publicKey);
            verifier.update(Base64.getDecoder().decode(encryptedData));
            boolean valid = verifier.verify(Base64.getDecoder().decode(signature));

            if (!valid) {
                LOG.warnf("Invalid signature for device login user '%s' and credential '%s'", userId, matched.getId());
                context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
                return;
            }

            LOG.infof("Device login token validated for user '%s' with credential '%s'", userId, matched.getId());
            context.setUser(user);
            context.success();
        } catch (Exception exception) {
            LOG.warnf(exception, "Device login validation failed");
            context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
        }
    }

    private PublicKey readPublicKey(String pem) throws Exception {
        String body = pem
                .replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s+", "");
        byte[] decoded = Base64.getDecoder().decode(body);
        return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(decoded));
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

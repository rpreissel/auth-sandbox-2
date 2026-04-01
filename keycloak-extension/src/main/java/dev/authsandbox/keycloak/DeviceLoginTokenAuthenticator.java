package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.jboss.logging.Logger;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.authenticators.util.AcrStore;
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

public class DeviceLoginTokenAuthenticator implements Authenticator {

    static final Logger LOG = Logger.getLogger(DeviceLoginTokenAuthenticator.class);
    private static final String DEVICE_LOGIN_ACR = "1se";
    private static final int DEVICE_LOGIN_LOA = 1;

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        try {
            String loginToken = LoginTokenSupport.resolveLoginToken(context);
            if (loginToken == null || loginToken.isBlank()) {
                LOG.info("No login_token found, device-login browser branch not attempted");
                context.attempted();
                return;
            }

            LoginTokenSupport.DeviceLoginPayload token = LoginTokenSupport.parseLoginToken(loginToken);
            if (!"device".equals(token.type())) {
                LOG.warnf("Unsupported login_token type '%s'", token.type());
                context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
                return;
            }
            LoginTokenSupport.validateExpiry(token);
            if (!LoginTokenSupport.markSingleUse(context.getSession(), token)) {
                LOG.warnf("login_token jti '%s' was already used", token.jti());
                context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
                return;
            }

            String userId = token.sub();
            String publicKeyHash = token.publicKeyHash();
            String encryptedData = token.encryptedData();
            String signature = token.signature();

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
            long authTime = System.currentTimeMillis() / 1000;
            context.getAuthenticationSession().setAuthNote("acr", DEVICE_LOGIN_ACR);
            context.getAuthenticationSession().setAuthNote("auth_time", Long.toString(authTime));
            context.getAuthenticationSession().setUserSessionNote("acr", DEVICE_LOGIN_ACR);
            context.getAuthenticationSession().setUserSessionNote("auth_time", Long.toString(authTime));
            context.getAuthenticationSession().setAuthNote("amr", "pwd");
            context.getAuthenticationSession().setUserSessionNote("amr", "pwd");
            recordLevelOfAuthentication(context, DEVICE_LOGIN_LOA);
            context.setUser(user);
            context.success();
        } catch (Exception exception) {
            LOG.warnf(exception, "Device login validation failed");
            context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
        }
    }

    private void recordLevelOfAuthentication(AuthenticationFlowContext context, int level) {
        AcrStore acrStore = new AcrStore(context.getSession(), context.getAuthenticationSession());
        acrStore.setLevelAuthenticated(level);

        String loaMap = context.getAuthenticationSession().getAuthNote("loa-map");
        if (loaMap != null) {
            context.getAuthenticationSession().setUserSessionNote("loa-map", loaMap);
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

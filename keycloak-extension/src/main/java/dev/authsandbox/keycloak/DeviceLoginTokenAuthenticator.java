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
import java.util.Map;

public class DeviceLoginTokenAuthenticator implements Authenticator {

    static final Logger LOG = Logger.getLogger(DeviceLoginTokenAuthenticator.class);
    private static final String DEVICE_LOGIN_ACR = "1se";
    private static final int DEVICE_LOGIN_LOA = 1;
    private static final String STRONG_DEVICE_LOGIN_ACR = "2se";
    private static final int STRONG_DEVICE_LOGIN_LOA = 2;

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        AuthFlowTraceSupport.AuthenticatorTrace trace = AuthFlowTraceSupport.start(context, DeviceLoginTokenAuthenticatorFactory.PROVIDER_ID, "authenticate");
        try {
            String loginToken = LoginTokenSupport.resolveLoginToken(context);
            if (loginToken == null || loginToken.isBlank()) {
                LOG.info("No login_token found, device-login browser branch not attempted");
                trace.recordArtifact("device_login_attempt", Map.of("attempted", true, "hasLoginToken", false),
                        "Device login browser authenticator skipped because no login_token was present.");
                trace.success("No login_token present; authenticator attempted but skipped.");
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
                trace.error("login_token jti already used.");
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
                trace.error("No Keycloak user found for login_token subject.");
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
                trace.error("No stored device credential matched publicKeyHash.");
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
                trace.error("Device login signature validation failed.");
                context.failure(AuthenticationFlowError.INVALID_CREDENTIALS);
                return;
            }

            LOG.infof("Device login token validated for user '%s' with credential '%s'", userId, matched.getId());
            trace.recordArtifact("device_login_validation", Map.of(
                    "userId", userId,
                    "requestedAcr", token.acr() == null ? "" : token.acr(),
                    "credentialId", matched.getId(),
                    "publicKeyHash", publicKeyHash,
                    "hasEncryptedData", encryptedData != null && !encryptedData.isBlank()
            ), "Validated device login token and matched the stored credential.");
            long authTime = System.currentTimeMillis() / 1000;
            String achievedAcr = STRONG_DEVICE_LOGIN_ACR.equals(token.acr()) ? STRONG_DEVICE_LOGIN_ACR : DEVICE_LOGIN_ACR;
            int achievedLoa = STRONG_DEVICE_LOGIN_ACR.equals(achievedAcr) ? STRONG_DEVICE_LOGIN_LOA : DEVICE_LOGIN_LOA;
            String achievedAmr = STRONG_DEVICE_LOGIN_ACR.equals(achievedAcr) ? "hwk" : "pwd";
            context.getAuthenticationSession().setAuthNote("acr", achievedAcr);
            context.getAuthenticationSession().setAuthNote("auth_time", Long.toString(authTime));
            context.getAuthenticationSession().setUserSessionNote("acr", achievedAcr);
            context.getAuthenticationSession().setUserSessionNote("auth_time", Long.toString(authTime));
            context.getAuthenticationSession().setAuthNote("amr", achievedAmr);
            context.getAuthenticationSession().setUserSessionNote("amr", achievedAmr);
            recordLevelOfAuthentication(context, achievedLoa);
            context.setUser(user);
            trace.success("Validated device login token and established Keycloak user session.");
            context.success();
        } catch (Exception exception) {
            LOG.warnf(exception, "Device login validation failed");
            trace.error(exception.getMessage());
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

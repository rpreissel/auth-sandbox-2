package dev.authsandbox.keycloak;

import org.keycloak.credential.CredentialInput;
import org.keycloak.credential.CredentialInputValidator;
import org.keycloak.credential.CredentialModel;
import org.keycloak.credential.CredentialProvider;
import org.keycloak.credential.CredentialProviderFactory;
import org.keycloak.credential.CredentialTypeMetadata;
import org.keycloak.credential.CredentialTypeMetadataContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

public class DeviceCredentialProvider implements CredentialProvider<DeviceCredentialModel>, CredentialInputValidator {

    public DeviceCredentialProvider(KeycloakSession session) {
    }

    @Override
    public String getType() {
        return DeviceCredentialModel.TYPE;
    }

    @Override
    public CredentialModel createCredential(RealmModel realm, UserModel user, DeviceCredentialModel credentialModel) {
        return user.credentialManager().createStoredCredential(credentialModel);
    }

    @Override
    public boolean deleteCredential(RealmModel realm, UserModel user, String credentialId) {
        return user.credentialManager().removeStoredCredentialById(credentialId);
    }

    @Override
    public DeviceCredentialModel getCredentialFromModel(CredentialModel model) {
        return DeviceCredentialModel.createFromCredentialModel(model);
    }

    @Override
    public boolean supportsCredentialType(String credentialType) {
        return DeviceCredentialModel.TYPE.equals(credentialType);
    }

    @Override
    public boolean isConfiguredFor(RealmModel realm, UserModel user, String credentialType) {
        return user.credentialManager().getStoredCredentialsByTypeStream(credentialType).findAny().isPresent();
    }

    @Override
    public boolean isValid(RealmModel realm, UserModel user, CredentialInput input) {
        return false;
    }

    @Override
    public CredentialTypeMetadata getCredentialTypeMetadata(CredentialTypeMetadataContext context) {
        return null;
    }

    public static class Factory implements CredentialProviderFactory<DeviceCredentialProvider> {
        public static final String PROVIDER_ID = DeviceCredentialModel.TYPE;

        @Override
        public String getId() {
            return PROVIDER_ID;
        }

        @Override
        public DeviceCredentialProvider create(KeycloakSession session) {
            return new DeviceCredentialProvider(session);
        }
    }
}

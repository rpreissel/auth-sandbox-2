package dev.authsandbox.keycloak;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.keycloak.credential.CredentialModel;

import java.util.Map;

public class DeviceCredentialModel extends CredentialModel {

    public static final String TYPE = "device-login";
    private static final ObjectMapper mapper = new ObjectMapper();

    public static DeviceCredentialModel create(String publicKey, String publicKeyHash, String encPrivKey) {
        DeviceCredentialModel model = new DeviceCredentialModel();
        model.setType(TYPE);
        model.setCreatedDate(System.currentTimeMillis());
        try {
            model.setCredentialData(mapper.writeValueAsString(Map.of(
                    "publicKey", publicKey,
                    "publicKeyHash", publicKeyHash
            )));
            model.setSecretData(mapper.writeValueAsString(Map.of(
                    "encPrivKey", encPrivKey
            )));
        } catch (Exception e) {
            throw new RuntimeException("Failed to create device credential model", e);
        }
        return model;
    }

    public static DeviceCredentialModel createFromCredentialModel(CredentialModel model) {
        DeviceCredentialModel credentialModel = new DeviceCredentialModel();
        credentialModel.setUserLabel(model.getUserLabel());
        credentialModel.setType(model.getType());
        credentialModel.setCreatedDate(model.getCreatedDate());
        credentialModel.setId(model.getId());
        credentialModel.setCredentialData(model.getCredentialData());
        credentialModel.setSecretData(model.getSecretData());
        return credentialModel;
    }

    public String getPublicKey() {
        return getValue(getCredentialData(), "publicKey");
    }

    public String getPublicKeyHash() {
        return getValue(getCredentialData(), "publicKeyHash");
    }

    public String getEncPrivKey() {
        return getValue(getSecretData(), "encPrivKey");
    }

    private String getValue(String json, String key) {
        try {
            Map<String, String> data = mapper.readValue(json, new TypeReference<Map<String, String>>() {});
            return data.get(key);
        } catch (Exception e) {
            return null;
        }
    }
}

package dev.authsandbox.keycloak;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.keycloak.credential.CredentialModel;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class DeviceCredentialModel extends CredentialModel {

    public static final String TYPE = "device-login";
    private static final ObjectMapper mapper = new ObjectMapper();

    public static DeviceCredentialModel create(String publicKeyHash, String handoverSecret) {
        return createWithBindings(List.of(new BindingEntry(publicKeyHash, null)), handoverSecret);
    }

    public static DeviceCredentialModel createWithBindings(List<BindingEntry> bindings, String handoverSecret) {
        DeviceCredentialModel model = new DeviceCredentialModel();
        model.setType(TYPE);
        model.setCreatedDate(System.currentTimeMillis());
        try {
            model.setCredentialData(mapper.writeValueAsString(Map.of(
                    "version", "handover-v2",
                    "bindings", bindings.stream().map(BindingEntry::toMap).toList()
            )));
            model.setSecretData(mapper.writeValueAsString(Map.of(
                    "handoverSecret", handoverSecret
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

    public String getVersion() {
        return getValue(getCredentialData(), "version");
    }

    public List<BindingEntry> getBindings() {
        try {
            Map<String, Object> data = mapper.readValue(getCredentialData(), new TypeReference<Map<String, Object>>() {});
            Object bindingsObj = data.get("bindings");
            if (!(bindingsObj instanceof List<?> list)) {
                return List.of();
            }
            List<BindingEntry> result = new ArrayList<>();
            for (Object item : list) {
                if (item instanceof Map<?, ?> entry) {
                    String pkHash = entry.get("publicKeyHash") != null ? String.valueOf(entry.get("publicKeyHash")) : null;
                    String deviceName = entry.get("deviceName") != null ? String.valueOf(entry.get("deviceName")) : null;
                    if (pkHash != null) {
                        result.add(new BindingEntry(pkHash, deviceName));
                    }
                }
            }
            return result;
        } catch (Exception e) {
            return List.of();
        }
    }

    public String getPublicKeyHash() {
        List<BindingEntry> bindings = getBindings();
        if (!bindings.isEmpty()) {
            return bindings.get(0).publicKeyHash();
        }
        return null;
    }

    public BindingEntry findBinding(String publicKeyHash) {
        return getBindings().stream()
                .filter(b -> b.publicKeyHash().equals(publicKeyHash))
                .findFirst()
                .orElse(null);
    }

    public String getHandoverSecret() {
        return getValue(getSecretData(), "handoverSecret");
    }

    private String getValue(String json, String key) {
        try {
            Map<String, Object> data = mapper.readValue(json, new TypeReference<Map<String, Object>>() {});
            Object value = data.get(key);
            return value != null ? String.valueOf(value) : null;
        } catch (Exception e) {
            return null;
        }
    }

    public record BindingEntry(String publicKeyHash, String deviceName) {
        public Map<String, String> toMap() {
            if (deviceName != null) {
                return Map.of("publicKeyHash", publicKeyHash, "deviceName", deviceName);
            }
            return Map.of("publicKeyHash", publicKeyHash);
        }
    }
}
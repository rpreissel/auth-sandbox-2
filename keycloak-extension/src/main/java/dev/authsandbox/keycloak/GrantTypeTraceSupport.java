package dev.authsandbox.keycloak;

import org.keycloak.models.ClientModel;
import org.keycloak.models.RealmModel;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

final class GrantTypeTraceSupport {

    private GrantTypeTraceSupport() {
    }

    static GrantTrace start(String inboundTraceId, String inboundSessionId, String requestUri, String route, String httpMethod,
                            String remoteHost, RealmModel realm, ClientModel client, String grantType, String grantId,
                            String authMethod, String principalHint, boolean usedLoginToken, boolean usedAssuranceHandle,
                            boolean usedRefreshToken) {
        TraceApiClient traceApiClient = new TraceApiClient();
        String traceId = firstNonBlank(inboundTraceId, UUID.randomUUID().toString());
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("grantId", grantId);
        metadata.put("grantType", grantType);
        metadata.put("authMethod", authMethod);
        metadata.put("clientId", client.getClientId());
        metadata.put("clientInternalId", client.getId());
        metadata.put("realmName", realm.getName());
        metadata.put("realmId", realm.getId());
        metadata.put("requestUri", requestUri);
        metadata.put("route", route);
        metadata.put("httpMethod", httpMethod);
        metadata.put("remoteHost", remoteHost);
        metadata.put("userId", principalHint);
        metadata.put("authSessionId", null);
        metadata.put("userSessionId", null);
        metadata.put("usedLoginToken", usedLoginToken);
        metadata.put("usedAssuranceHandle", usedAssuranceHandle);
        metadata.put("usedRefreshToken", usedRefreshToken);
        metadata.put("usedResultCode", false);
        metadata.put("usedBrowserServiceToken", false);
        metadata.put("usedInternalServiceToken", true);

        TraceApiClient.TraceEnvelope trace = traceApiClient.ensureTrace(
                traceId,
                "keycloak_grant",
                "Keycloak " + grantId,
                "Custom Keycloak grant processing captured for trace attribution.",
                client.getClientId(),
                requestUri,
                principalHint,
                inboundSessionId
        );
        String spanId = traceApiClient.startSpan(
                trace,
                null,
                "process",
                "keycloak",
                "keycloak-extension",
                grantId + ".process",
                httpMethod,
                requestUri,
                route,
                client.getClientId(),
                principalHint,
                inboundSessionId,
                "grantType=" + grantType + " authMethod=" + authMethod
        );
        traceApiClient.recordJsonArtifact(
                spanId,
                "grant_context",
                "grant_context",
                "internal",
                metadata,
                "Keycloak custom grant context used to attribute token endpoint activity."
        );
        return new GrantTrace(traceApiClient, trace, spanId, metadata);
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        return second != null && !second.isBlank() ? second : null;
    }

    record GrantTrace(TraceApiClient traceApiClient, TraceApiClient.TraceEnvelope trace, String spanId, Map<String, Object> metadata) {

        void updateResolvedUser(String userId, String keycloakUserId) {
            metadata.put("userId", userId);
            metadata.put("keycloakUserId", keycloakUserId);
        }

        void updateSessions(String authSessionId, String userSessionId) {
            metadata.put("authSessionId", authSessionId);
            metadata.put("userSessionId", userSessionId);
        }

        void updateAssurance(String acr, Object amr) {
            metadata.put("acr", acr);
            metadata.put("amr", amr);
        }

        void recordArtifact(String name, Object value, String explanation) {
            traceApiClient.recordJsonArtifact(spanId, name, name, "internal", value, explanation);
        }

        void refreshContextArtifact() {
            traceApiClient.recordJsonArtifact(spanId, "grant_context", "grant_context", "internal", metadata,
                    "Updated Keycloak custom grant context for trace attribution.");
        }

        void success(String notes) {
            traceApiClient.completeSpan(spanId, "success", null, notes);
        }

        void error(String notes) {
            traceApiClient.completeSpan(spanId, "error", null, notes);
        }

        AuthApiClient.TraceContext outboundContext() {
            return new AuthApiClient.TraceContext(
                    trace.traceId(),
                    trace.correlationId(),
                    trace.sessionId(),
                    spanId,
                    stringValue(metadata.get("clientId")),
                    stringValue(metadata.get("userId")),
                    stringValue(metadata.get("requestUri")),
                    stringValue(metadata.get("grantId")),
                    null,
                    null
            );
        }

        private String stringValue(Object value) {
            return value instanceof String && !((String) value).isBlank() ? (String) value : null;
        }
    }
}

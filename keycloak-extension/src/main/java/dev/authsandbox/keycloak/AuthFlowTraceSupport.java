package dev.authsandbox.keycloak;

import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.AuthenticationFlowModel;
import org.keycloak.models.UserModel;

import java.util.LinkedHashMap;
import java.util.Map;

final class AuthFlowTraceSupport {

    private static final String ACTOR_NAME = "keycloak-extension";

    private AuthFlowTraceSupport() {
    }

    static AuthenticatorTrace start(AuthenticationFlowContext context, String authenticatorId, String operation) {
        TraceApiClient traceApiClient = new TraceApiClient();
        Map<String, Object> metadata = buildMetadata(context, authenticatorId, operation);
        String requestUri = stringValue(metadata.get("requestUri"));
        String sessionId = stringValue(metadata.get("authSessionId"));
        String userId = stringValue(metadata.get("userId"));
        String traceHint = stringValue(metadata.get("traceHint"));
        TraceApiClient.TraceEnvelope trace = traceHint != null
                ? new TraceApiClient.TraceEnvelope(traceHint, traceHint, sessionId)
                : traceApiClient.ensureTrace(
                        sessionId != null ? sessionId : requestUri,
                        "keycloak_authenticator",
                        "Keycloak " + authenticatorId,
                        "Custom Keycloak authenticator activity captured for trace attribution.",
                        stringValue(metadata.get("clientId")),
                        requestUri,
                        userId,
                        sessionId
                );
        String notes = "realm=" + stringValue(metadata.get("realmName"))
                + " flow=" + stringValue(metadata.get("flowAlias"))
                + " executionId=" + stringValue(metadata.get("executionId"));
        String spanId = traceApiClient.startSpan(
                trace,
                null,
                "process",
                "keycloak",
                ACTOR_NAME,
                authenticatorId + "." + operation,
                stringValue(metadata.get("method")),
                requestUri,
                stringValue(metadata.get("route")),
                stringValue(metadata.get("clientId")),
                userId,
                sessionId,
                notes
        );
        traceApiClient.recordJsonArtifact(
                spanId,
                "auth_context",
                "auth_context",
                "internal",
                metadata,
                "Keycloak authentication context used to attribute the origin of custom authenticator activity."
        );
        return new AuthenticatorTrace(traceApiClient, trace, spanId, metadata);
    }

    private static Map<String, Object> buildMetadata(AuthenticationFlowContext context, String authenticatorId, String operation) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        AuthenticationExecutionModel execution = context.getExecution();
        String flowId = execution != null ? execution.getParentFlow() : null;
        AuthenticationFlowModel flow = flowId != null ? context.getRealm().getAuthenticationFlowById(flowId) : null;
        UserModel user = context.getUser() != null ? context.getUser() : context.getAuthenticationSession().getAuthenticatedUser();
        String loginHint = context.getAuthenticationSession().getClientNote("client_request_param_login_hint");
        if (loginHint == null || loginHint.isBlank()) {
            loginHint = context.getHttpRequest().getUri().getQueryParameters().getFirst("login_hint");
        }

        metadata.put("authenticatorId", authenticatorId);
        metadata.put("operation", operation);
        metadata.put("clientId", context.getAuthenticationSession().getClient() != null ? context.getAuthenticationSession().getClient().getClientId() : null);
        metadata.put("requestUri", context.getHttpRequest().getUri().getRequestUri().toString());
        metadata.put("route", context.getHttpRequest().getUri().getPath());
        metadata.put("method", context.getHttpRequest().getHttpMethod());
        metadata.put("realmName", context.getRealm().getName());
        metadata.put("realmId", context.getRealm().getId());
        metadata.put("executionId", execution != null ? execution.getId() : null);
        metadata.put("flowId", flowId);
        metadata.put("flowAlias", flow != null ? flow.getAlias() : null);
        metadata.put("userId", user != null ? user.getUsername() : null);
        metadata.put("keycloakUserId", user != null ? user.getId() : null);
        metadata.put("authSessionId", context.getAuthenticationSession().getParentSession() != null ? context.getAuthenticationSession().getParentSession().getId() : null);
        metadata.put("tabId", context.getAuthenticationSession().getTabId());
        metadata.put("loginHint", loginHint);
        metadata.put("traceHint", resolveClientRequestValue(context, "trace_hint"));
        metadata.put("hasLoginToken", hasValue(context, "login_token"));
        metadata.put("hasResultCode", hasValue(context, "result_code"));
        return metadata;
    }

    private static String resolveClientRequestValue(AuthenticationFlowContext context, String name) {
        String clientNote = context.getAuthenticationSession().getClientNote("client_request_param_" + name);
        if (clientNote == null || clientNote.isBlank()) {
            clientNote = context.getAuthenticationSession().getClientNote(name);
        }
        if (clientNote == null || clientNote.isBlank()) {
            clientNote = context.getAuthenticationSession().getAuthNote(name);
        }
        if (clientNote == null || clientNote.isBlank()) {
            clientNote = context.getHttpRequest().getUri().getQueryParameters().getFirst(name);
        }
        return clientNote != null && !clientNote.isBlank() ? clientNote : null;
    }

    private static boolean hasValue(AuthenticationFlowContext context, String name) {
        String clientNote = context.getAuthenticationSession().getClientNote("client_request_param_" + name);
        if (clientNote == null || clientNote.isBlank()) {
            clientNote = context.getAuthenticationSession().getClientNote(name);
        }
        if (clientNote == null || clientNote.isBlank()) {
            clientNote = context.getHttpRequest().getUri().getQueryParameters().getFirst(name);
        }
        return clientNote != null && !clientNote.isBlank();
    }

    private static String stringValue(Object value) {
        return value instanceof String && !((String) value).isBlank() ? (String) value : null;
    }

    record AuthenticatorTrace(TraceApiClient traceApiClient, TraceApiClient.TraceEnvelope trace, String spanId, Map<String, Object> metadata) {

        AuthApiClient.TraceContext outboundContext() {
            return new AuthApiClient.TraceContext(
                    trace.traceId(),
                    trace.correlationId(),
                    trace.sessionId(),
                    spanId,
                    stringValue(metadata.get("clientId")),
                    stringValue(metadata.get("userId")),
                    stringValue(metadata.get("requestUri")),
                    stringValue(metadata.get("authenticatorId")),
                    stringValue(metadata.get("flowId")),
                    stringValue(metadata.get("flowAlias"))
            );
        }

        void recordArtifact(String name, Object value, String explanation) {
            traceApiClient.recordJsonArtifact(spanId, name, name, "internal", value, explanation);
        }

        void success(String notes) {
            traceApiClient.completeSpan(spanId, "success", null, notes);
        }

        void error(String notes) {
            traceApiClient.completeSpan(spanId, "error", null, notes);
        }

        private String stringValue(Object value) {
            return value instanceof String && !((String) value).isBlank() ? (String) value : null;
        }
    }
}

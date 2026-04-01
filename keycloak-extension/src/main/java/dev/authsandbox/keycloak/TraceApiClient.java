package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.jboss.logging.Logger;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

final class TraceApiClient {

    private static final Logger LOG = Logger.getLogger(TraceApiClient.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(5);

    private final HttpClient httpClient;
    private final String traceApiInternalUrl;
    private final String traceApiInternalWriteToken;

    TraceApiClient() {
        this(
                HttpClient.newHttpClient(),
                System.getenv("TRACE_API_INTERNAL_URL"),
                System.getenv("TRACE_API_INTERNAL_WRITE_TOKEN")
        );
    }

    TraceApiClient(HttpClient httpClient, String traceApiInternalUrl, String traceApiInternalWriteToken) {
        this.httpClient = httpClient;
        this.traceApiInternalUrl = traceApiInternalUrl;
        this.traceApiInternalWriteToken = traceApiInternalWriteToken;
    }

    boolean isEnabled() {
        return traceApiInternalUrl != null && !traceApiInternalUrl.isBlank()
                && traceApiInternalWriteToken != null && !traceApiInternalWriteToken.isBlank();
    }

    TraceEnvelope ensureTrace(String preferredTraceId, String traceType, String title, String summary, String rootClient, String rootEntrypoint, String userId, String sessionId) {
        String normalizedTraceId = normalizeTraceId(preferredTraceId);
        if (!isEnabled()) {
            return new TraceEnvelope(normalizedTraceId, normalizedTraceId, sessionId);
        }

        String traceId = normalizedTraceId;
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("traceId", traceId);
        body.put("correlationId", traceId);
        body.put("traceType", traceType);
        body.put("title", title);
        body.put("summary", summary);
        body.put("rootClient", rootClient);
        body.put("rootEntrypoint", rootEntrypoint);
        body.put("userId", userId);
        body.put("sessionId", sessionId);

        try {
            String response = sendJson("/internal/observability/traces/ensure", body);
            Map<?, ?> parsed = MAPPER.readValue(response, Map.class);
            Object responseTraceId = parsed.get("traceId");
            Object responseCorrelationId = parsed.get("correlationId");
            return new TraceEnvelope(
                    responseTraceId instanceof String && !((String) responseTraceId).isBlank() ? (String) responseTraceId : traceId,
                    responseCorrelationId instanceof String && !((String) responseCorrelationId).isBlank() ? (String) responseCorrelationId : traceId,
                    sessionId
            );
        } catch (Exception exception) {
            LOG.debugf(exception, "Failed to ensure trace for '%s'", title);
            return new TraceEnvelope(traceId, traceId, sessionId);
        }
    }

    private String normalizeTraceId(String preferredTraceId) {
        if (preferredTraceId == null || preferredTraceId.isBlank()) {
            return UUID.randomUUID().toString();
        }

        try {
            return UUID.fromString(preferredTraceId).toString();
        } catch (IllegalArgumentException ignored) {
            return UUID.nameUUIDFromBytes(preferredTraceId.getBytes()).toString();
        }
    }

    String startSpan(TraceEnvelope trace, String parentSpanId, String kind, String actorType, String actorName, String operation,
                     String method, String url, String route, String targetName, String userId, String sessionId, String notes) {
        if (!isEnabled()) {
            return null;
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("traceId", trace.traceId());
        body.put("parentSpanId", parentSpanId);
        body.put("kind", kind);
        body.put("actorType", actorType);
        body.put("actorName", actorName);
        body.put("operation", operation);
        body.put("method", method);
        body.put("url", url);
        body.put("route", route);
        body.put("targetName", targetName);
        body.put("userId", userId);
        body.put("sessionId", sessionId != null ? sessionId : trace.sessionId());
        body.put("notes", notes);

        try {
            String response = sendJson("/internal/observability/spans/start", body);
            Map<?, ?> parsed = MAPPER.readValue(response, Map.class);
            Object spanId = parsed.get("spanId");
            return spanId instanceof String ? (String) spanId : null;
        } catch (Exception exception) {
            LOG.debugf(exception, "Failed to start span '%s'", operation);
            return null;
        }
    }

    void recordJsonArtifact(String spanId, String artifactType, String name, String direction, Object value, String explanation) {
        if (!isEnabled() || spanId == null || spanId.isBlank()) {
            return;
        }

        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("spanId", spanId);
            body.put("artifactType", artifactType);
            body.put("name", name);
            body.put("contentType", "application/json");
            body.put("encoding", "json");
            body.put("direction", direction);
            body.put("rawValue", MAPPER.writeValueAsString(value));
            body.put("explanation", explanation);
            sendJson("/internal/observability/artifacts/record", body);
        } catch (Exception exception) {
            LOG.debugf(exception, "Failed to record artifact '%s'", name);
        }
    }

    void completeSpan(String spanId, String status, Integer statusCode, String notes) {
        if (!isEnabled() || spanId == null || spanId.isBlank()) {
            return;
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("spanId", spanId);
        body.put("status", status);
        body.put("statusCode", statusCode);
        body.put("notes", notes);

        try {
            sendJson("/internal/observability/spans/complete", body);
        } catch (Exception exception) {
            LOG.debugf(exception, "Failed to complete span '%s'", spanId);
        }
    }

    private String sendJson(String path, Object body) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(traceApiInternalUrl + path))
                .timeout(REQUEST_TIMEOUT)
                .header("authorization", "Bearer " + traceApiInternalWriteToken)
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body)))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IOException("Trace API write failed: " + response.statusCode() + " " + response.body());
        }
        return response.body();
    }

    record TraceEnvelope(String traceId, String correlationId, String sessionId) {
    }
}

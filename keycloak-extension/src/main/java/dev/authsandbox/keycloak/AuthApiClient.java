package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class AuthApiClient {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient httpClient;
    private final String authApiBaseUrl;
    private final String keycloakBaseUrl;
    private final String keycloakRealm;
    private final String internalRedeemClientId;
    private final String internalRedeemClientSecret;
    private final TraceApiClient traceApiClient;

    public AuthApiClient() {
        this(
                HttpClient.newHttpClient(),
                System.getenv().getOrDefault("AUTH_API_INTERNAL_URL", "http://auth-api:3000"),
                System.getenv().getOrDefault("KEYCLOAK_BASE_URL", "http://127.0.0.1:8080"),
                System.getenv().getOrDefault("KEYCLOAK_REALM", "auth-sandbox-2"),
                System.getenv().getOrDefault("KEYCLOAK_INTERNAL_REDEEM_CLIENT_ID", "auth-api-internal-redeem"),
                System.getenv().getOrDefault("KEYCLOAK_INTERNAL_REDEEM_CLIENT_SECRET", "change-me-internal-redeem"),
                new TraceApiClient()
        );
    }

    AuthApiClient(HttpClient httpClient, String authApiBaseUrl, String keycloakBaseUrl, String keycloakRealm, String internalRedeemClientId, String internalRedeemClientSecret, TraceApiClient traceApiClient) {
        this.httpClient = httpClient;
        this.authApiBaseUrl = authApiBaseUrl;
        this.keycloakBaseUrl = keycloakBaseUrl;
        this.keycloakRealm = keycloakRealm;
        this.internalRedeemClientId = internalRedeemClientId;
        this.internalRedeemClientSecret = internalRedeemClientSecret;
        this.traceApiClient = traceApiClient;
    }

    public FlowArtifactRedeemResult redeemArtifact(String code, String kind) throws IOException, InterruptedException {
        return redeemArtifact(code, kind, null);
    }

    public FlowArtifactRedeemResult redeemArtifact(String code, String kind, TraceContext traceContext) throws IOException, InterruptedException {
        String accessToken = getServiceAccessToken(traceContext);
        String spanId = startOutboundSpan(traceContext, "auth_api.redeem_artifact", "POST", authApiBaseUrl + "/api/internal/flows/redeem", "auth-api");
        recordRequestArtifact(spanId, Map.of("kind", kind, "hasCode", code != null && !code.isBlank()));
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(authApiBaseUrl + "/api/internal/flows/redeem"))
                .timeout(REQUEST_TIMEOUT)
                .header("content-type", "application/json")
                .header("authorization", "Bearer " + accessToken)
                .header("x-client-name", "keycloak-extension")
                .headers(traceHeaders(traceContext))
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(Map.of(
                        "code", code,
                        "kind", kind
                ))))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            finishOutboundSpan(spanId, "error", response.statusCode(), "Redeem failed");
            throw new IOException("Redeem failed: " + response.statusCode() + " " + response.body());
        }

        JsonNode root = MAPPER.readTree(response.body());
        FlowArtifactRedeemResult result = new FlowArtifactRedeemResult(
                requiredText(root, "flowId"),
                requiredText(root, "userId"),
                requiredText(root, "purpose"),
                root.path("achievedAcr").isTextual() ? root.path("achievedAcr").asText() : null,
                root.path("authTime").asText(),
                root.path("amr").isArray()
                        ? MAPPER.convertValue(root.path("amr"), MAPPER.getTypeFactory().constructCollectionType(java.util.List.class, String.class))
                        : java.util.List.of()
        );
        recordResponseArtifact(spanId, Map.of(
                "flowId", result.flowId(),
                "userId", result.userId(),
                "purpose", result.purpose(),
                "achievedAcr", result.achievedAcr(),
                "amr", result.amr()
        ));
        finishOutboundSpan(spanId, "success", response.statusCode(), "Redeemed flow artifact via auth-api.");
        return result;
    }

    public BrowserSmsChallenge startBrowserStepUp(String userId) throws IOException, InterruptedException {
        return startBrowserStepUp(userId, null);
    }

    public BrowserSmsChallenge startBrowserStepUp(String userId, TraceContext traceContext) throws IOException, InterruptedException {
        String spanId = startOutboundSpan(traceContext, "auth_api.browser_step_up_start", "POST", authApiBaseUrl + "/api/internal/browser-step-up/start", "auth-api");
        recordRequestArtifact(spanId, Map.of("userId", userId));
        HttpRequest request = authorizedJsonRequest(
                authApiBaseUrl + "/api/internal/browser-step-up/start",
                MAPPER.writeValueAsString(Map.of("userId", userId)),
                traceContext
        );

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            finishOutboundSpan(spanId, "error", response.statusCode(), "Browser step-up start failed");
            throw new IOException("Browser step-up start failed: " + response.statusCode() + " " + response.body());
        }

        JsonNode root = MAPPER.readTree(response.body());
        BrowserSmsChallenge result = new BrowserSmsChallenge(
                requiredText(root, "flowId"),
                requiredText(root, "serviceToken"),
                textOrNull(root, "maskedTarget"),
                textOrNull(root, "devCode")
        );
        recordResponseArtifact(spanId, Map.of(
                "flowId", result.flowId(),
                "maskedTarget", result.maskedTarget(),
                "hasServiceToken", result.serviceToken() != null && !result.serviceToken().isBlank(),
                "hasDevCode", result.devCode() != null && !result.devCode().isBlank()
        ));
        finishOutboundSpan(spanId, "success", response.statusCode(), "Started browser step-up via auth-api.");
        return result;
    }

    public BrowserStepUpResult completeBrowserStepUp(String flowId, String serviceToken, String tan) throws IOException, InterruptedException {
        return completeBrowserStepUp(flowId, serviceToken, tan, null);
    }

    public BrowserStepUpResult completeBrowserStepUp(String flowId, String serviceToken, String tan, TraceContext traceContext) throws IOException, InterruptedException {
        String spanId = startOutboundSpan(traceContext, "auth_api.browser_step_up_complete", "POST", authApiBaseUrl + "/api/internal/browser-step-up/complete", "auth-api");
        recordRequestArtifact(spanId, Map.of(
                "flowId", flowId,
                "hasServiceToken", serviceToken != null && !serviceToken.isBlank(),
                "hasTan", tan != null && !tan.isBlank()
        ));
        HttpRequest completeRequest = authorizedJsonRequest(
                authApiBaseUrl + "/api/internal/browser-step-up/complete",
                MAPPER.writeValueAsString(Map.of(
                        "flowId", flowId,
                        "serviceToken", serviceToken,
                        "tan", tan
                )),
                traceContext
        );

        HttpResponse<String> completeResponse = httpClient.send(completeRequest, HttpResponse.BodyHandlers.ofString());
        if (completeResponse.statusCode() < 200 || completeResponse.statusCode() >= 300) {
            finishOutboundSpan(spanId, "error", completeResponse.statusCode(), "Browser step-up complete failed");
            throw new IOException("Browser step-up complete failed: " + completeResponse.statusCode() + " " + completeResponse.body());
        }

        JsonNode finalized = MAPPER.readTree(completeResponse.body());
        JsonNode result = finalized.path("result");
        BrowserStepUpResult response = new BrowserStepUpResult(
                "level_2".equals(textOrNull(result, "achievedAcr")) ? "2se" : textOrNull(result, "achievedAcr"),
                java.util.List.of("sms")
        );
        recordResponseArtifact(spanId, Map.of(
                "achievedAcr", response.achievedAcr(),
                "amr", response.amr()
        ));
        finishOutboundSpan(spanId, "success", completeResponse.statusCode(), "Completed browser step-up via auth-api.");
        return response;
    }

    private HttpRequest authorizedJsonRequest(String uri, String body, TraceContext traceContext) throws IOException, InterruptedException {
        String accessToken = getServiceAccessToken(traceContext);
        return HttpRequest.newBuilder()
                .uri(URI.create(uri))
                .timeout(REQUEST_TIMEOUT)
                .header("content-type", "application/json")
                .header("authorization", "Bearer " + accessToken)
                .header("x-client-name", "keycloak-extension")
                .headers(traceHeaders(traceContext))
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
    }

    private String getServiceAccessToken(TraceContext traceContext) throws IOException, InterruptedException {
        String form = "grant_type=client_credentials"
                + "&client_id=" + urlEncode(internalRedeemClientId)
                + "&client_secret=" + urlEncode(internalRedeemClientSecret);
        String spanId = startOutboundSpan(traceContext, "keycloak.service_token_request", "POST", keycloakBaseUrl + "/realms/" + keycloakRealm + "/protocol/openid-connect/token", "keycloak");
        recordRequestArtifact(spanId, Map.of("grantType", "client_credentials", "clientId", internalRedeemClientId));

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(keycloakBaseUrl + "/realms/" + keycloakRealm + "/protocol/openid-connect/token"))
                .timeout(REQUEST_TIMEOUT)
                .header("content-type", "application/x-www-form-urlencoded")
                .header("x-client-name", "keycloak-extension")
                .headers(traceHeaders(traceContext))
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            finishOutboundSpan(spanId, "error", response.statusCode(), "Service token request failed");
            throw new IOException("Service token request failed: " + response.statusCode() + " " + response.body());
        }

        JsonNode root = MAPPER.readTree(response.body());
        String accessToken = requiredText(root, "access_token");
        recordResponseArtifact(spanId, Map.of(
                "tokenType", textOrNull(root, "token_type"),
                "expiresIn", root.path("expires_in").isNumber() ? root.path("expires_in").asInt() : null,
                "hasAccessToken", !accessToken.isBlank()
        ));
        finishOutboundSpan(spanId, "success", response.statusCode(), "Fetched internal Keycloak service token.");
        return accessToken;
    }

    private String[] traceHeaders(TraceContext traceContext) {
        if (traceContext == null || traceContext.traceId() == null || traceContext.traceId().isBlank()) {
            return new String[0];
        }
        if (traceContext.sessionId() != null && !traceContext.sessionId().isBlank() && traceContext.parentSpanId() != null && !traceContext.parentSpanId().isBlank()) {
            return new String[]{
                    "x-trace-id", traceContext.traceId(),
                    "x-correlation-id", traceContext.correlationId(),
                    "x-session-id", traceContext.sessionId(),
                    "x-span-id", traceContext.parentSpanId()
            };
        }
        if (traceContext.sessionId() != null && !traceContext.sessionId().isBlank()) {
            return new String[]{
                    "x-trace-id", traceContext.traceId(),
                    "x-correlation-id", traceContext.correlationId(),
                    "x-session-id", traceContext.sessionId()
            };
        }
        if (traceContext.parentSpanId() != null && !traceContext.parentSpanId().isBlank()) {
            return new String[]{
                    "x-trace-id", traceContext.traceId(),
                    "x-correlation-id", traceContext.correlationId(),
                    "x-span-id", traceContext.parentSpanId()
            };
        }
        return new String[]{
                "x-trace-id", traceContext.traceId(),
                "x-correlation-id", traceContext.correlationId()
        };
    }

    private String startOutboundSpan(TraceContext traceContext, String operation, String method, String url, String targetName) {
        if (traceContext == null) {
            return null;
        }
        String notes = "clientId=" + traceContext.clientId()
                + " authenticatorId=" + traceContext.authenticatorId()
                + " flowAlias=" + traceContext.flowAlias();
        return traceApiClient.startSpan(
                new TraceApiClient.TraceEnvelope(traceContext.traceId(), traceContext.correlationId(), traceContext.sessionId()),
                traceContext.parentSpanId(),
                "http_out",
                "keycloak",
                "keycloak-extension",
                operation,
                method,
                url,
                URI.create(url).getPath(),
                targetName,
                traceContext.userId(),
                traceContext.sessionId(),
                notes
        );
    }

    private void finishOutboundSpan(String spanId, String status, Integer statusCode, String notes) {
        traceApiClient.completeSpan(spanId, status, statusCode, notes);
    }

    private void recordRequestArtifact(String spanId, Map<String, Object> requestSummary) {
        traceApiClient.recordJsonArtifact(spanId, "request_summary", "outgoing_request_summary", "outbound", requestSummary,
                "Outbound Keycloak extension request summary for trace attribution.");
    }

    private void recordResponseArtifact(String spanId, Map<String, Object> responseSummary) {
        traceApiClient.recordJsonArtifact(spanId, "response_summary", "incoming_response_summary", "inbound", responseSummary,
                "Outbound Keycloak extension response summary for trace attribution.");
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String requiredText(JsonNode root, String field) {
        JsonNode node = root.path(field);
        if (!node.isTextual() || node.asText().isBlank()) {
            throw new IllegalArgumentException("Missing field from auth-api response: " + field);
        }
        return node.asText();
    }

    private static String textOrNull(JsonNode root, String field) {
        JsonNode node = root.path(field);
        return node.isTextual() && !node.asText().isBlank() ? node.asText() : null;
    }

    public record FlowArtifactRedeemResult(
            String flowId,
            String userId,
            String purpose,
            String achievedAcr,
            String authTime,
            java.util.List<String> amr
    ) {
    }

    public record BrowserSmsChallenge(
            String flowId,
            String serviceToken,
            String maskedTarget,
            String devCode
    ) {
    }

    public record BrowserStepUpResult(
            String achievedAcr,
            java.util.List<String> amr
    ) {
    }

    public record TraceContext(
            String traceId,
            String correlationId,
            String sessionId,
            String parentSpanId,
            String clientId,
            String userId,
            String requestUri,
            String authenticatorId,
            String flowId,
            String flowAlias
    ) {
    }
}

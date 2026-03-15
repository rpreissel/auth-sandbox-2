package dev.authsandbox.keycloak;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
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

    public AuthApiClient() {
        this(
                HttpClient.newHttpClient(),
                System.getenv().getOrDefault("AUTH_API_INTERNAL_URL", "http://auth-api:3000"),
                System.getenv().getOrDefault("KEYCLOAK_BASE_URL", "http://127.0.0.1:8080"),
                System.getenv().getOrDefault("KEYCLOAK_REALM", "auth-sandbox-2"),
                System.getenv().getOrDefault("KEYCLOAK_INTERNAL_REDEEM_CLIENT_ID", "auth-api-internal-redeem"),
                System.getenv().getOrDefault("KEYCLOAK_INTERNAL_REDEEM_CLIENT_SECRET", "change-me-internal-redeem")
        );
    }

    AuthApiClient(HttpClient httpClient, String authApiBaseUrl, String keycloakBaseUrl, String keycloakRealm, String internalRedeemClientId, String internalRedeemClientSecret) {
        this.httpClient = httpClient;
        this.authApiBaseUrl = authApiBaseUrl;
        this.keycloakBaseUrl = keycloakBaseUrl;
        this.keycloakRealm = keycloakRealm;
        this.internalRedeemClientId = internalRedeemClientId;
        this.internalRedeemClientSecret = internalRedeemClientSecret;
    }

    public FlowArtifactRedeemResult redeemArtifact(String code, String kind) throws IOException, InterruptedException {
        String accessToken = getServiceAccessToken();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(authApiBaseUrl + "/api/internal/flows/redeem"))
                .timeout(REQUEST_TIMEOUT)
                .header("content-type", "application/json")
                .header("authorization", "Bearer " + accessToken)
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(Map.of(
                        "code", code,
                        "kind", kind
                ))))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IOException("Redeem failed: " + response.statusCode() + " " + response.body());
        }

        JsonNode root = MAPPER.readTree(response.body());
        return new FlowArtifactRedeemResult(
                requiredText(root, "flowId"),
                requiredText(root, "userId"),
                requiredText(root, "purpose"),
                root.path("achievedAcr").isTextual() ? root.path("achievedAcr").asText() : null,
                root.path("authTime").asText(),
                root.path("amr").isArray()
                        ? MAPPER.convertValue(root.path("amr"), MAPPER.getTypeFactory().constructCollectionType(java.util.List.class, String.class))
                        : java.util.List.of()
        );
    }

    private String getServiceAccessToken() throws IOException, InterruptedException {
        String form = "grant_type=client_credentials"
                + "&client_id=" + urlEncode(internalRedeemClientId)
                + "&client_secret=" + urlEncode(internalRedeemClientSecret);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(keycloakBaseUrl + "/realms/" + keycloakRealm + "/protocol/openid-connect/token"))
                .timeout(REQUEST_TIMEOUT)
                .header("content-type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IOException("Service token request failed: " + response.statusCode() + " " + response.body());
        }

        JsonNode root = MAPPER.readTree(response.body());
        return requiredText(root, "access_token");
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

    public record FlowArtifactRedeemResult(
            String flowId,
            String userId,
            String purpose,
            String achievedAcr,
            String authTime,
            java.util.List<String> amr
    ) {
    }
}

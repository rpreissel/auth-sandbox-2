package dev.authsandbox.keycloak;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.NotAuthorizedException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.credential.CredentialModel;
import org.keycloak.representations.AccessToken;
import org.keycloak.services.managers.AppAuthManager;
import org.keycloak.services.resource.RealmResourceProvider;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class DeviceCredentialResourceProvider implements RealmResourceProvider {

    private final KeycloakSession session;

    public DeviceCredentialResourceProvider(KeycloakSession session) {
        this.session = session;
    }

    @Override
    public Object getResource() {
        return this;
    }

    @Path("")
    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createCredential(CreateDeviceCredentialRequest request) {
        if (request == null || request.keycloakUserId() == null || request.keycloakUserId().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("error", "keycloak_user_id_required"))
                    .build();
        }
        if (request.publicKeyHash() == null || request.publicKeyHash().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("error", "public_key_hash_required"))
                    .build();
        }
        if (request.handoverSecret() == null || request.handoverSecret().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("error", "handover_secret_required"))
                    .build();
        }

        requireManageUsers();

        RealmModel realm = session.getContext().getRealm();
        UserModel user = session.users().getUserById(realm, request.keycloakUserId());
        if (user == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity(Map.of("error", "user_not_found"))
                    .build();
        }

        List<DeviceCredentialModel.BindingEntry> allBindings = new ArrayList<>();
        String existingCredentialId = null;

        List<CredentialModel> existing = user.credentialManager()
                .getStoredCredentialsByTypeStream(DeviceCredentialModel.TYPE)
                .toList();
        for (CredentialModel cred : existing) {
            DeviceCredentialModel existingModel = DeviceCredentialModel.createFromCredentialModel(cred);
            if ("handover-v2".equals(existingModel.getVersion())) {
                existingCredentialId = cred.getId();
                allBindings.addAll(existingModel.getBindings());
            } else {
                existingCredentialId = cred.getId();
            }
        }

        allBindings.removeIf(b -> b.publicKeyHash().equals(request.publicKeyHash()));
        allBindings.add(new DeviceCredentialModel.BindingEntry(request.publicKeyHash(), request.deviceName()));

        DeviceCredentialModel newCredential = DeviceCredentialModel.createWithBindings(allBindings, request.handoverSecret());

        String label = allBindings.size() == 1 && request.deviceName() != null
                ? request.deviceName()
                : "device-login";
        newCredential.setUserLabel(label);

        String createdId;
        if (existingCredentialId != null) {
            user.credentialManager().removeStoredCredentialById(existingCredentialId);
        }
        createdId = user.credentialManager().createStoredCredential(newCredential).getId();

        return Response.status(Response.Status.CREATED)
                .entity(Map.of("credentialId", createdId))
                .build();
    }

    private void requireManageUsers() {
        RealmModel realm = session.getContext().getRealm();
        AppAuthManager.BearerTokenAuthenticator authenticator = new AppAuthManager.BearerTokenAuthenticator(session)
                .setRealm(realm)
                .setConnection(session.getContext().getConnection())
                .setHeaders(session.getContext().getRequestHeaders());

        AppAuthManager.AuthResult result = authenticator.authenticate();
        if (result == null) {
            throw new NotAuthorizedException("Bearer");
        }

        AccessToken.Access resourceAccess = result.getToken().getResourceAccess("realm-management");
        if (resourceAccess == null || !resourceAccess.isUserInRole("manage-users")) {
            throw new ForbiddenException("manage-users role required");
        }
    }

    @Override
    public void close() {
    }

    public record CreateDeviceCredentialRequest(
            String keycloakUserId,
            String deviceName,
            String publicKeyHash,
            String handoverSecret
    ) {
    }
}
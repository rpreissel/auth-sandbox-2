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

import java.util.Map;

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
        if (request.deviceName() == null || request.deviceName().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("error", "device_name_required"))
                    .build();
        }
        if (request.publicKey() == null || request.publicKey().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("error", "public_key_required"))
                    .build();
        }
        if (request.publicKeyHash() == null || request.publicKeyHash().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("error", "public_key_hash_required"))
                    .build();
        }
        if (request.encPrivKey() == null || request.encPrivKey().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("error", "enc_priv_key_required"))
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

        DeviceCredentialModel credential = DeviceCredentialModel.create(
                request.publicKey(),
                request.publicKeyHash(),
                request.encPrivKey()
        );
        credential.setUserLabel(request.deviceName());

        CredentialModel created = user.credentialManager().createStoredCredential(credential);
        return Response.status(Response.Status.CREATED)
                .entity(Map.of("credentialId", created.getId()))
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
            String publicKey,
            String publicKeyHash,
            String encPrivKey
    ) {
    }
}

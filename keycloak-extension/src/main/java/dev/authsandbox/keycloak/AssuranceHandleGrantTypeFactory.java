package dev.authsandbox.keycloak;

import org.keycloak.Config;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.protocol.oidc.grants.OAuth2GrantType;
import org.keycloak.protocol.oidc.grants.OAuth2GrantTypeFactory;

public class AssuranceHandleGrantTypeFactory implements OAuth2GrantTypeFactory {

    public static final String GRANT_TYPE = "urn:auth-sandbox-2:params:oauth:grant-type:assurance-handle";
    public static final String GRANT_SHORTCUT = "ah";

    @Override
    public String getId() {
        return GRANT_TYPE;
    }

    @Override
    public String getShortcut() {
        return GRANT_SHORTCUT;
    }

    @Override
    public OAuth2GrantType create(KeycloakSession session) {
        return new AssuranceHandleGrantType();
    }

    @Override
    public void init(Config.Scope config) {
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
    }

    @Override
    public void close() {
    }
}

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = "~> 5.3"
    }
  }
}

provider "keycloak" {
  client_id     = "admin-cli"
  username      = var.keycloak_admin
  password      = var.keycloak_admin_password
  url           = var.keycloak_url
  realm         = "master"
  initial_login = false
  tls_insecure_skip_verify = true
}

resource "keycloak_realm" "realm" {
  realm        = var.realm_name
  enabled      = true
  display_name = "auth-sandbox-2"
}

resource "keycloak_realm_user_profile" "realm_profile" {
  realm_id = keycloak_realm.realm.id

  attribute {
    name         = "username"
    display_name = "$${username}"

    validator {
      name = "length"
      config = {
        min = "1"
        max = "255"
      }
    }

    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
  }

  attribute {
    name         = "email"
    display_name = "$${email}"

    validator {
      name = "length"
      config = {
        max = "255"
      }
    }

    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
  }

  attribute {
    name         = "firstName"
    display_name = "$${firstName}"

    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
  }

  attribute {
    name         = "lastName"
    display_name = "$${lastName}"

    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
  }
}

resource "keycloak_authentication_flow" "device_login_flow" {
  realm_id    = keycloak_realm.realm.id
  alias       = "device-login-flow"
  description = "Browser flow for device login_token exchange"
  provider_id = "basic-flow"
}

resource "keycloak_authentication_execution" "device_login_token" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.device_login_flow.alias
  authenticator     = "device-login-token"
  requirement       = "REQUIRED"
}

resource "keycloak_openid_client_scope" "profile_scope" {
  realm_id               = keycloak_realm.realm.id
  name                   = "auth-sandbox-profile"
  description            = "Profile scope for auth-sandbox-2"
  include_in_token_scope = true
}

resource "keycloak_openid_client_scope" "mock_api_scope" {
  realm_id               = keycloak_realm.realm.id
  name                   = "mock-api-access"
  description            = "Audience scope for mock-api"
  include_in_token_scope = true
}

resource "keycloak_openid_audience_protocol_mapper" "mock_api_audience" {
  realm_id        = keycloak_realm.realm.id
  client_scope_id = keycloak_openid_client_scope.mock_api_scope.id
  name            = "mock-api-audience"

  add_to_access_token = true
  add_to_id_token     = false

  included_custom_audience = var.mock_api_audience
}

resource "keycloak_openid_client" "app_web" {
  realm_id                     = keycloak_realm.realm.id
  client_id                    = "app-web"
  name                         = "app-web"
  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = true
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  valid_redirect_uris          = ["https://app.localhost:8443/*", "https://auth.localhost:8443/blank"]
  web_origins                  = ["+"]
  client_secret                = var.app_client_secret

  authentication_flow_binding_overrides {
    browser_id = keycloak_authentication_flow.device_login_flow.id
  }
}

resource "keycloak_openid_client_default_scopes" "app_default_scopes" {
  realm_id  = keycloak_realm.realm.id
  client_id = keycloak_openid_client.app_web.id
  default_scopes = [
    "profile",
    "email",
    keycloak_openid_client_scope.profile_scope.name,
    keycloak_openid_client_scope.mock_api_scope.name
  ]
}

resource "keycloak_openid_client" "auth_api_admin" {
  realm_id                     = keycloak_realm.realm.id
  client_id                    = var.admin_client_id
  name                         = var.admin_client_id
  access_type                  = "CONFIDENTIAL"
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  direct_access_grants_enabled = false
  client_secret                = var.admin_client_secret
}

data "keycloak_openid_client" "realm_management" {
  realm_id  = keycloak_realm.realm.id
  client_id = "realm-management"

  depends_on = [keycloak_realm.realm]
}

data "keycloak_role" "manage_users" {
  realm_id  = keycloak_realm.realm.id
  client_id = data.keycloak_openid_client.realm_management.id
  name      = "manage-users"
}

data "keycloak_role" "view_users" {
  realm_id  = keycloak_realm.realm.id
  client_id = data.keycloak_openid_client.realm_management.id
  name      = "view-users"
}

resource "keycloak_openid_client_service_account_role" "manage_users" {
  realm_id                = keycloak_realm.realm.id
  service_account_user_id = keycloak_openid_client.auth_api_admin.service_account_user_id
  client_id               = data.keycloak_openid_client.realm_management.id
  role                    = data.keycloak_role.manage_users.name
}

resource "keycloak_openid_client_service_account_role" "view_users" {
  realm_id                = keycloak_realm.realm.id
  service_account_user_id = keycloak_openid_client.auth_api_admin.service_account_user_id
  client_id               = data.keycloak_openid_client.realm_management.id
  role                    = data.keycloak_role.view_users.name
}

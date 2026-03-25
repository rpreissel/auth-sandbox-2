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

  attributes = {
    "acr.loa.map" = jsonencode({
      "1se" = 1
      "2se" = 2
    })
  }
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

resource "keycloak_openid_client_scope" "profile_scope" {
  realm_id               = keycloak_realm.realm.id
  name                   = "auth-sandbox-profile"
  description            = "Profile scope for auth-sandbox-2"
  include_in_token_scope = true
}

resource "keycloak_openid_client_scope" "servicemock_api_scope" {
  realm_id               = keycloak_realm.realm.id
  name                   = "servicemock-api-access"
  description            = "Audience scope for servicemock-api"
  include_in_token_scope = true
}

resource "keycloak_authentication_flow" "browser_step_up_flow" {
  realm_id    = keycloak_realm.realm.id
  alias       = "browser-step-up-flow"
  description = "Browser flow with LoA conditions and inline SMS-TAN step-up"
  provider_id = "basic-flow"
}

resource "keycloak_authentication_execution" "browser_cookie" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.browser_step_up_flow.alias
  authenticator     = "auth-cookie"
  requirement       = "ALTERNATIVE"
  priority          = 10
}

resource "keycloak_authentication_subflow" "browser_auth_flow" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.browser_step_up_flow.alias
  alias             = "browser-step-up-auth"
  description       = "Interactive browser authentication with LoA-aware branches"
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 20
}

resource "keycloak_authentication_subflow" "browser_loa_1_flow" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_subflow.browser_auth_flow.alias
  alias             = "browser-step-up-loa-1"
  description       = "Initial password login for LoA 1"
  provider_id       = "basic-flow"
  requirement       = "CONDITIONAL"
  priority          = 10
}

resource "keycloak_authentication_execution" "browser_loa_1_condition" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_subflow.browser_loa_1_flow.alias
  authenticator     = "conditional-level-of-authentication"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_authentication_execution_config" "browser_loa_1_condition" {
  realm_id     = keycloak_realm.realm.id
  execution_id = keycloak_authentication_execution.browser_loa_1_condition.id
  alias        = "browser-loa-1-condition"

  config = {
    "loa-condition-level" = "1"
    "loa-max-age"         = "36000"
  }
}

resource "keycloak_authentication_execution" "browser_username_password" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_subflow.browser_loa_1_flow.alias
  authenticator     = "auth-username-password-form"
  requirement       = "REQUIRED"
  priority          = 20
}

resource "keycloak_authentication_subflow" "browser_loa_2_flow" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_subflow.browser_auth_flow.alias
  alias             = "browser-step-up-loa-2"
  description       = "Step-up branch for LoA 2 using inline SMS-TAN verification"
  provider_id       = "basic-flow"
  requirement       = "CONDITIONAL"
  priority          = 20
}

resource "keycloak_authentication_execution" "browser_loa_2_condition" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_subflow.browser_loa_2_flow.alias
  authenticator     = "conditional-level-of-authentication"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_authentication_execution_config" "browser_loa_2_condition" {
  realm_id     = keycloak_realm.realm.id
  execution_id = keycloak_authentication_execution.browser_loa_2_condition.id
  alias        = "browser-loa-2-condition"

  config = {
    "loa-condition-level" = "2"
    "loa-max-age"         = "36000"
  }
}

resource "keycloak_authentication_execution" "browser_step_up_sms" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_subflow.browser_loa_2_flow.alias
  authenticator     = "sms-tan-authenticator"
  requirement       = "REQUIRED"
  priority          = 20
}

resource "keycloak_openid_audience_protocol_mapper" "servicemock_api_audience" {
  realm_id        = keycloak_realm.realm.id
  client_scope_id = keycloak_openid_client_scope.servicemock_api_scope.id
  name            = "servicemock-api-audience"

  add_to_access_token = true
  add_to_id_token     = false

  included_custom_audience = var.servicemock_api_audience
}

resource "keycloak_openid_client" "app_web" {
  realm_id                     = keycloak_realm.realm.id
  client_id                    = "appmock-web"
  name                         = "appmock-web"
  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = false
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  valid_redirect_uris          = []
  web_origins                  = []
  client_secret                = var.app_client_secret
}

resource "keycloak_openid_client" "browser_app" {
  realm_id                     = keycloak_realm.realm.id
  client_id                    = var.browser_client_id
  name                         = var.browser_client_id
  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  valid_redirect_uris          = ["https://webmock.localhost:8443/*"]
  web_origins                  = ["https://webmock.localhost:8443"]

  extra_config = {
    "default.acr.values" = "1se"
    "minimum.acr.value"  = "1se"
  }

  authentication_flow_binding_overrides {
    browser_id = keycloak_authentication_flow.browser_step_up_flow.id
  }
}

resource "keycloak_openid_client_default_scopes" "browser_default_scopes" {
  realm_id  = keycloak_realm.realm.id
  client_id = keycloak_openid_client.browser_app.id
  default_scopes = [
    "acr",
    "profile",
    "email",
    keycloak_openid_client_scope.profile_scope.name,
    keycloak_openid_client_scope.servicemock_api_scope.name
  ]
}

resource "keycloak_openid_client_default_scopes" "app_default_scopes" {
  realm_id  = keycloak_realm.realm.id
  client_id = keycloak_openid_client.app_web.id
  default_scopes = [
    "acr",
    "profile",
    "email",
    keycloak_openid_client_scope.profile_scope.name,
    keycloak_openid_client_scope.servicemock_api_scope.name
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

resource "keycloak_openid_client" "internal_redeem" {
  realm_id                     = keycloak_realm.realm.id
  client_id                    = var.internal_redeem_client_id
  name                         = var.internal_redeem_client_id
  access_type                  = "CONFIDENTIAL"
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  direct_access_grants_enabled = false
  client_secret                = var.internal_redeem_client_secret
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

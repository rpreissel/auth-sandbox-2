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
  client_id                = "admin-cli"
  username                 = var.keycloak_admin
  password                 = var.keycloak_admin_password
  url                      = var.keycloak_url
  realm                    = "master"
  initial_login            = false
  tls_insecure_skip_verify = true
}

resource "keycloak_realm" "realm" {
  realm        = var.realm_name
  enabled      = true
  display_name = "auth-sandbox-2"

  attributes = {
    "acr.loa.map" = jsonencode({
      "ekw" = 0
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

resource "keycloak_openid_client_scope" "broker_profile_scope" {
  realm_id               = keycloak_realm.realm.id
  name                   = "ekwmock-broker-profile"
  description            = "Expose broker-specific user attributes in tokens"
  include_in_token_scope = true
}

resource "keycloak_openid_user_attribute_protocol_mapper" "broker_ekw_sub" {
  realm_id        = keycloak_realm.realm.id
  client_scope_id = keycloak_openid_client_scope.broker_profile_scope.id
  name            = "broker-ekw-sub"
  user_attribute  = "ekw_sub"
  claim_name      = "ekw_sub"
  claim_value_type = "String"
  add_to_access_token = true
  add_to_id_token     = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_attribute_protocol_mapper" "broker_user_id" {
  realm_id        = keycloak_realm.realm.id
  client_scope_id = keycloak_openid_client_scope.broker_profile_scope.id
  name            = "broker-user-id"
  user_attribute  = "userId"
  claim_name      = "userId"
  claim_value_type = "String"
  add_to_access_token = true
  add_to_id_token     = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_attribute_protocol_mapper" "broker_source_user_id" {
  realm_id        = keycloak_realm.realm.id
  client_scope_id = keycloak_openid_client_scope.broker_profile_scope.id
  name            = "broker-source-user-id"
  user_attribute  = "source_user_id"
  claim_name      = "source_user_id"
  claim_value_type = "String"
  add_to_access_token = true
  add_to_id_token     = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_attribute_protocol_mapper" "broker_allowed_target_client_id" {
  realm_id        = keycloak_realm.realm.id
  client_scope_id = keycloak_openid_client_scope.broker_profile_scope.id
  name            = "broker-allowed-target-client-id"
  user_attribute  = "allowed_target_client_id"
  claim_name      = "allowed_target_client_id"
  claim_value_type = "String"
  add_to_access_token = true
  add_to_id_token     = true
  add_to_userinfo     = true
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

resource "keycloak_authentication_execution" "browser_ekw_session_reuse_guard" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.browser_step_up_flow.alias
  authenticator     = "ekw-session-reuse-guard"
  requirement       = "REQUIRED"
  priority          = 20
}

resource "keycloak_authentication_subflow" "browser_auth_flow" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.browser_step_up_flow.alias
  alias             = "browser-step-up-auth"
  description       = "Interactive browser authentication with LoA-aware branches"
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 40
}

resource "keycloak_authentication_flow" "tanmock_first_broker_login_flow" {
  realm_id    = keycloak_realm.realm.id
  alias       = "tanmock-first-broker-login"
  description = "First broker login flow for TAN Mock that creates a brokered user without extra profile prompts"
  provider_id = "basic-flow"
}

resource "keycloak_authentication_execution" "tanmock_first_broker_review_profile" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.tanmock_first_broker_login_flow.alias
  authenticator     = "idp-review-profile"
  requirement       = "DISABLED"
  priority          = 10
}

resource "keycloak_authentication_execution" "tanmock_first_broker_create_user" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.tanmock_first_broker_login_flow.alias
  authenticator     = "idp-create-user-if-unique"
  requirement       = "REQUIRED"
  priority          = 20
}

resource "keycloak_authentication_execution" "tanmock_first_broker_handle_existing" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.tanmock_first_broker_login_flow.alias
  authenticator     = "idp-confirm-link"
  requirement       = "DISABLED"
  priority          = 30
}

resource "keycloak_authentication_flow" "browser_device_bootstrap_flow" {
  realm_id    = keycloak_realm.realm.id
  alias       = "browser-device-bootstrap-flow"
  description = "Browser flow for bootstrap requests that authenticate only with device login tokens"
  provider_id = "basic-flow"
}

resource "keycloak_authentication_execution" "bootstrap_device_login_authenticator" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.browser_device_bootstrap_flow.alias
  authenticator     = "device-login-token"
  requirement       = "REQUIRED"
  priority          = 10
}

# ── EKW Login Flow (Erstlogin via EKW-Mock-Broker) ──────────────────────────

resource "keycloak_authentication_flow" "browser_ekw_login_flow" {
  realm_id    = keycloak_realm.realm.id
  alias       = "browser-ekw-login-flow"
  description = "Browser flow for initial EKW-Mock login (acr ekw only, no step-up)"
  provider_id = "basic-flow"
}

resource "keycloak_authentication_execution" "ekw_login_cookie" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.browser_ekw_login_flow.alias
  authenticator     = "auth-cookie"
  requirement       = "ALTERNATIVE"
  priority          = 10
}

resource "keycloak_authentication_execution" "ekw_login_idp_redirect" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.browser_ekw_login_flow.alias
  authenticator     = "identity-provider-redirector"
  requirement       = "ALTERNATIVE"
  priority          = 20
}

resource "keycloak_authentication_execution_config" "ekw_login_idp_redirect" {
  realm_id     = keycloak_realm.realm.id
  execution_id = keycloak_authentication_execution.ekw_login_idp_redirect.id
  alias        = "ekw-login-idp-redirect"

  config = {
    defaultProvider = keycloak_oidc_identity_provider.ekwmock.alias
  }
}

resource "keycloak_authentication_execution" "ekw_session_arm" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_flow.browser_ekw_login_flow.alias
  authenticator     = "ekw-session-arm"
  requirement       = "REQUIRED"
  priority          = 30
}

resource "keycloak_openid_client" "ekw_login_app" {
  realm_id                     = keycloak_realm.realm.id
  client_id                    = var.ekw_login_client_id
  name                         = var.ekw_login_client_id
  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  valid_redirect_uris          = ["https://webmock.localhost:8443/*"]
  web_origins                  = ["https://webmock.localhost:8443"]

  extra_config = {
    "default.acr.values" = "ekw"
    "minimum.acr.value"  = "ekw"
  }

  authentication_flow_binding_overrides {
    browser_id = keycloak_authentication_flow.browser_ekw_login_flow.id
  }
}

resource "keycloak_openid_client_default_scopes" "ekw_login_default_scopes" {
  realm_id  = keycloak_realm.realm.id
  client_id = keycloak_openid_client.ekw_login_app.id
  default_scopes = [
    "acr",
    "profile",
    "email",
    keycloak_openid_client_scope.broker_profile_scope.name,
    keycloak_openid_client_scope.profile_scope.name,
    keycloak_openid_client_scope.servicemock_api_scope.name
  ]
}

# ── LoA-1 Zweig: Username/Password ───────────────────────────────────────────

resource "keycloak_authentication_subflow" "browser_loa_1_flow" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_subflow.browser_auth_flow.alias
  alias             = "browser-step-up-loa-1"
  description       = "LoA-1 branch: username/password login"
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

resource "keycloak_authentication_execution" "browser_loa_1_username_password" {
  realm_id          = keycloak_realm.realm.id
  parent_flow_alias = keycloak_authentication_subflow.browser_loa_1_flow.alias
  authenticator     = "auth-username-password-form"
  requirement       = "REQUIRED"
  priority          = 20
}

# ── Step-up Flow (LoA 2 via SMS-TAN, setzt LoA-1-Session voraus) ─────────────

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

  authentication_flow_binding_overrides {
    browser_id = keycloak_authentication_flow.browser_step_up_flow.id
  }
}

resource "keycloak_openid_client" "bootstrap_app" {
  realm_id                     = keycloak_realm.realm.id
  client_id                    = var.bootstrap_client_id
  name                         = var.bootstrap_client_id
  access_type                  = "CONFIDENTIAL"
  standard_flow_enabled        = true
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  valid_redirect_uris          = ["https://auth.localhost:8443/api/sso-bootstrap/callback"]
  web_origins                  = []
  client_secret                = var.bootstrap_client_secret

  extra_config = {
    "default.acr.values" = "1se"
    "minimum.acr.value"  = "1se"
  }

  authentication_flow_binding_overrides {
    browser_id = keycloak_authentication_flow.browser_device_bootstrap_flow.id
  }
}

resource "keycloak_openid_client_default_scopes" "browser_default_scopes" {
  realm_id  = keycloak_realm.realm.id
  client_id = keycloak_openid_client.browser_app.id
  default_scopes = [
    "acr",
    "profile",
    "email",
    keycloak_openid_client_scope.broker_profile_scope.name,
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
    keycloak_openid_client_scope.broker_profile_scope.name,
    keycloak_openid_client_scope.profile_scope.name,
    keycloak_openid_client_scope.servicemock_api_scope.name
  ]
}

resource "keycloak_openid_client_default_scopes" "bootstrap_default_scopes" {
  realm_id  = keycloak_realm.realm.id
  client_id = keycloak_openid_client.bootstrap_app.id
  default_scopes = [
    "acr",
    "profile",
    "email"
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

resource "keycloak_role" "tanmock_admin" {
  realm_id = keycloak_realm.realm.id
  name     = "tanmock-admin"
}

resource "keycloak_user" "tanmock_admin" {
  realm_id = keycloak_realm.realm.id
  username = "tanmock-admin"
  enabled  = true

  first_name = "TAN Mock"
  last_name  = "Admin"
  email      = "tanmock-admin@localhost.localdomain"

  initial_password {
    value     = "ChangeMe123!"
    temporary = false
  }
}

resource "keycloak_user_roles" "tanmock_admin" {
  realm_id = keycloak_realm.realm.id
  user_id  = keycloak_user.tanmock_admin.id
  role_ids = [keycloak_role.tanmock_admin.id]
}

resource "keycloak_openid_client" "tanmock_admin_web" {
  realm_id                     = keycloak_realm.realm.id
  client_id                    = var.tanmock_admin_client_id
  name                         = var.tanmock_admin_client_id
  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  valid_redirect_uris          = ["https://tanmock.localhost:8443/*", "https://admin.localhost:8443/*"]
  web_origins                  = ["https://tanmock.localhost:8443", "https://admin.localhost:8443"]
}

resource "keycloak_openid_client_default_scopes" "tanmock_admin_default_scopes" {
  realm_id  = keycloak_realm.realm.id
  client_id = keycloak_openid_client.tanmock_admin_web.id
  default_scopes = [
    "profile",
    "email"
  ]
}

resource "keycloak_oidc_identity_provider" "ekwmock" {
  realm                    = keycloak_realm.realm.id
  alias                    = "ekwmock"
  display_name             = "EKW Mock"
  authorization_url        = "https://tanmock.localhost:8443/oidc/authorize"
  token_url                = "http://tanmock-api:3003/oidc/token"
  user_info_url            = "http://tanmock-api:3003/oidc/userinfo"
  jwks_url                 = "http://tanmock-api:3003/oidc/jwks"
  issuer                   = "https://tanmock.localhost:8443"
  client_id                = var.tanmock_client_id
  client_secret            = var.tanmock_client_secret
  default_scopes           = "openid profile email"
  enabled                  = true
  trust_email              = true
  hide_on_login_page       = true
  sync_mode                = "FORCE"
  validate_signature       = true
  disable_user_info        = false
  first_broker_login_flow_alias = keycloak_authentication_flow.tanmock_first_broker_login_flow.alias

  extra_config = {
    "clientAuthMethod" = "client_secret_post"
  }
}

resource "keycloak_user_template_importer_identity_provider_mapper" "ekwmock_username" {
  realm                   = keycloak_realm.realm.id
  name                    = "ekwmock-username-template"
  identity_provider_alias = keycloak_oidc_identity_provider.ekwmock.alias
  template                = "$${CLAIM.ekw_sub}"

  extra_config = {
    syncMode = "INHERIT"
  }
}

resource "keycloak_attribute_importer_identity_provider_mapper" "ekwmock_email" {
  realm                   = keycloak_realm.realm.id
  name                    = "ekwmock-email"
  identity_provider_alias = keycloak_oidc_identity_provider.ekwmock.alias
  user_attribute          = "email"
  claim_name              = "email"

  extra_config = {
    syncMode = "INHERIT"
  }
}

resource "keycloak_attribute_importer_identity_provider_mapper" "ekwmock_ekw_sub" {
  realm                   = keycloak_realm.realm.id
  name                    = "ekwmock-ekw-sub"
  identity_provider_alias = keycloak_oidc_identity_provider.ekwmock.alias
  user_attribute          = "ekw_sub"
  claim_name              = "ekw_sub"

  extra_config = {
    syncMode = "INHERIT"
  }
}

resource "keycloak_attribute_importer_identity_provider_mapper" "ekwmock_user_id" {
  realm                   = keycloak_realm.realm.id
  name                    = "ekwmock-user-id"
  identity_provider_alias = keycloak_oidc_identity_provider.ekwmock.alias
  user_attribute          = "userId"
  claim_name              = "userId"

  extra_config = {
    syncMode = "INHERIT"
  }
}

resource "keycloak_attribute_importer_identity_provider_mapper" "ekwmock_first_name" {
  realm                   = keycloak_realm.realm.id
  name                    = "ekwmock-first-name"
  identity_provider_alias = keycloak_oidc_identity_provider.ekwmock.alias
  user_attribute          = "firstName"
  claim_name              = "given_name"

  extra_config = {
    syncMode = "INHERIT"
  }
}

resource "keycloak_attribute_importer_identity_provider_mapper" "ekwmock_last_name" {
  realm                   = keycloak_realm.realm.id
  name                    = "ekwmock-last-name"
  identity_provider_alias = keycloak_oidc_identity_provider.ekwmock.alias
  user_attribute          = "lastName"
  claim_name              = "family_name"

  extra_config = {
    syncMode = "INHERIT"
  }
}

resource "keycloak_attribute_importer_identity_provider_mapper" "ekwmock_source_user_id" {
  realm                   = keycloak_realm.realm.id
  name                    = "ekwmock-source-user-id"
  identity_provider_alias = keycloak_oidc_identity_provider.ekwmock.alias
  user_attribute          = "source_user_id"
  claim_name              = "source_user_id"

  extra_config = {
    syncMode = "INHERIT"
  }
}

resource "keycloak_attribute_importer_identity_provider_mapper" "ekwmock_allowed_target_client_id" {
  realm                   = keycloak_realm.realm.id
  name                    = "ekwmock-allowed-target-client-id"
  identity_provider_alias = keycloak_oidc_identity_provider.ekwmock.alias
  user_attribute          = "allowed_target_client_id"
  claim_name              = "allowed_target_client_id"

  extra_config = {
    syncMode = "INHERIT"
  }
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

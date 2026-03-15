variable "keycloak_url" {
  type = string
}

variable "keycloak_admin" {
  type = string
}

variable "keycloak_admin_password" {
  type      = string
  sensitive = true
}

variable "realm_name" {
  type    = string
  default = "auth-sandbox-2"
}

variable "app_client_secret" {
  type      = string
  sensitive = true
}

variable "browser_client_id" {
  type    = string
  default = "browser-app"
}

variable "browser_client_secret" {
  type      = string
  sensitive = true
}

variable "admin_client_id" {
  type    = string
  default = "auth-api-admin"
}

variable "admin_client_secret" {
  type      = string
  sensitive = true
}

variable "internal_redeem_client_id" {
  type    = string
  default = "auth-api-internal-redeem"
}

variable "internal_redeem_client_secret" {
  type      = string
  sensitive = true
}

variable "mock_api_audience" {
  type    = string
  default = "mock-api"
}

#!/usr/bin/env bash
set -eu

STATE_DIR="${TOFU_STATE_DIR:-/state}"
STATE_PATH="${STATE_DIR}/keycloak.tfstate"

mkdir -p "${STATE_DIR}"

MANAGEMENT_URL="${KEYCLOAK_URL/http:\/\/keycloak:8080/http://keycloak:9000}"

until wget -q -O /dev/null "${MANAGEMENT_URL}/health/ready"; do
  echo "waiting for keycloak..."
  sleep 3
done

attempt=1

apply_config() {
  tofu init -input=false && tofu apply \
    -input=false \
    -auto-approve \
    -state="${STATE_PATH}" \
    -var="keycloak_url=${KEYCLOAK_URL}" \
    -var="keycloak_admin=${KEYCLOAK_ADMIN}" \
    -var="keycloak_admin_password=${KEYCLOAK_ADMIN_PASSWORD}" \
    -var="realm_name=${KEYCLOAK_REALM}" \
    -var="app_client_secret=${KEYCLOAK_CLIENT_SECRET}" \
    -var="browser_client_id=${KEYCLOAK_BROWSER_CLIENT_ID:-webmock-web}" \
    -var="browser_client_secret=${KEYCLOAK_BROWSER_CLIENT_SECRET:-change-me-browser}" \
    -var="bootstrap_client_id=${KEYCLOAK_SSO_BOOTSTRAP_CLIENT_ID:-sso-bootstrap-web}" \
    -var="bootstrap_client_secret=${KEYCLOAK_SSO_BOOTSTRAP_CLIENT_SECRET:-change-me-bootstrap}" \
    -var="admin_client_secret=${KEYCLOAK_ADMIN_CLIENT_SECRET}" \
    -var="internal_redeem_client_id=${KEYCLOAK_INTERNAL_REDEEM_CLIENT_ID:-auth-api-internal-redeem}" \
    -var="internal_redeem_client_secret=${KEYCLOAK_INTERNAL_REDEEM_CLIENT_SECRET:-change-me-internal-redeem}" \
    -var="servicemock_api_audience=${SERVICEMOCK_API_AUDIENCE:-servicemock-api}" \
    "$@"
}

while true; do
  if tofu state list -state="${STATE_PATH}" 2>/dev/null | grep -qx 'keycloak_authentication_flow.device_login_flow'; then
    echo "migrating appmock-web away from legacy device-login browser flow"
    if ! apply_config -target=keycloak_openid_client.app_web; then
      echo "targeted appmock-web migration failed on attempt ${attempt}; retrying in 5 seconds"
      attempt=$((attempt + 1))
      sleep 5
      continue
    fi
  fi

  if apply_config; then
    echo "keycloak config applied successfully"
    exit 0
  fi

  echo "keycloak config apply failed on attempt ${attempt}; retrying in 5 seconds"
  attempt=$((attempt + 1))
  sleep 5
done

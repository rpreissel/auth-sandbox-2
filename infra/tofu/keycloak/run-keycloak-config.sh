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

while true; do
  tofu init -input=false
  tofu apply \
    -input=false \
    -auto-approve \
    -state="${STATE_PATH}" \
    -var="keycloak_url=${KEYCLOAK_URL}" \
    -var="keycloak_admin=${KEYCLOAK_ADMIN}" \
    -var="keycloak_admin_password=${KEYCLOAK_ADMIN_PASSWORD}" \
    -var="realm_name=${KEYCLOAK_REALM}" \
    -var="app_client_secret=${KEYCLOAK_CLIENT_SECRET}" \
    -var="admin_client_secret=${KEYCLOAK_ADMIN_CLIENT_SECRET}"
  sleep 30
done

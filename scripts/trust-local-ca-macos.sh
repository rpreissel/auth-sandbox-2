#!/usr/bin/env bash
set -eu

CERT_DIR="${1:-$(pwd)/local-certs}"
CA_CERT="${CERT_DIR}/rootCA.pem"

if [ ! -f "${CA_CERT}" ]; then
  printf 'CA certificate not found: %s\n' "${CA_CERT}" >&2
  exit 1
fi

security add-trusted-cert -d -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "${CA_CERT}"
printf 'Trusted CA in login keychain: %s\n' "${CA_CERT}"

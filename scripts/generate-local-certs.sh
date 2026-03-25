#!/usr/bin/env bash
set -eu

CERT_DIR="${1:-$(pwd)/local-certs}"
CA_KEY="${CERT_DIR}/rootCA.key"
CA_CERT="${CERT_DIR}/rootCA.pem"
SERVER_KEY="${CERT_DIR}/localhost.key"
SERVER_CSR="${CERT_DIR}/localhost.csr"
SERVER_CERT="${CERT_DIR}/localhost.crt"
SERVER_EXT="${CERT_DIR}/localhost.ext"

mkdir -p "${CERT_DIR}"

if [ ! -f "${CA_KEY}" ] || [ ! -f "${CA_CERT}" ]; then
  openssl genrsa -out "${CA_KEY}" 4096
  openssl req -x509 -new -nodes -key "${CA_KEY}" -sha256 -days 3650 \
    -out "${CA_CERT}" \
    -subj "/C=DE/ST=Local/L=Local/O=auth-sandbox-2/OU=Development/CN=auth-sandbox-2 Local Root CA"
fi

openssl genrsa -out "${SERVER_KEY}" 2048
openssl req -new -key "${SERVER_KEY}" -out "${SERVER_CSR}" \
  -subj "/C=DE/ST=Local/L=Local/O=auth-sandbox-2/OU=Development/CN=home.localhost"

cat > "${SERVER_EXT}" <<'EOF'
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = home.localhost
DNS.2 = appmock.localhost
DNS.3 = admin.localhost
DNS.4 = auth.localhost
DNS.5 = keycloak.localhost
DNS.6 = trace.localhost
DNS.7 = webmock.localhost
DNS.8 = db.localhost
EOF

openssl x509 -req -in "${SERVER_CSR}" -CA "${CA_CERT}" -CAkey "${CA_KEY}" \
  -CAcreateserial -out "${SERVER_CERT}" -days 825 -sha256 -extfile "${SERVER_EXT}"

rm -f "${SERVER_CSR}" "${SERVER_EXT}"

printf 'Generated CA: %s\nGenerated cert: %s\nGenerated key: %s\n' "${CA_CERT}" "${SERVER_CERT}" "${SERVER_KEY}"
